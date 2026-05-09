const { Router } = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const db = require('../db/connection');
const config = require('../config');
const { saveFile, deleteFile, moveFile, copyFile, replaceFile } = require('../services/file-manager');
const { generateCover, getBranding } = require('../services/cover-generator');
const { requireSession } = require('../middleware/auth');
const { validateUpload, sanitizeOriginalName, ValidationError } = require('../services/upload-validator');

const upload = multer({
  dest: '/tmp/luna-visor-uploads/',
  limits: { fileSize: 500 * 1024 * 1024, files: 20 },
});

const uploadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  keyGenerator: req => req.apiKeyClientId ? `key:${req.apiKeyClientId}` : `ip:${ipKeyGenerator(req.ip)}`,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many uploads, slow down.' },
});

const coverLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  keyGenerator: req => req.apiKeyClientId ? `cover-key:${req.apiKeyClientId}` : `cover-ip:${ipKeyGenerator(req.ip)}`,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many cover generations, slow down.' },
});

function cleanupTempFiles(req) {
  const files = (req.files || []).concat(req.file ? [req.file] : []);
  for (const f of files) {
    if (f && f.path) {
      try { fs.unlinkSync(f.path); } catch {}
    }
  }
}

const router = Router();

function fileToResponse(file) {
  if (!file) return null;
  const cdnUrl = `${config.CDN_BASE_URL}/${file.id}.${file.extension}`;
  return { ...file, cdn_url: cdnUrl };
}

router.get('/', requireSession, (req, res) => {
  const { client_id } = req.query;
  let files;
  if (client_id) {
    files = db.prepare('SELECT * FROM files WHERE client_id = ? ORDER BY created_at DESC').all(client_id);
  } else {
    files = db.prepare('SELECT * FROM files ORDER BY created_at DESC').all();
  }
  res.json(files.map(fileToResponse));
});

router.get('/:id', requireSession, (req, res) => {
  const file = db.prepare('SELECT * FROM files WHERE id = ?').get(req.params.id);
  if (!file) return res.status(404).json({ error: 'File not found' });
  res.json(fileToResponse(file));
});

router.post('/upload', uploadLimiter, upload.array('files', 20), async (req, res) => {
  const isApiKey = req.authMethod === 'api-key';
  const client_id = isApiKey ? req.apiKeyClientId : req.body.client_id;

  if (!client_id) {
    cleanupTempFiles(req);
    return res.status(400).json({ error: 'client_id required' });
  }

  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(client_id);
  if (!client) {
    cleanupTempFiles(req);
    return res.status(404).json({ error: 'Client not found' });
  }

  const results = [];
  for (const f of req.files) {
    try {
      await validateUpload(f.path, f.originalname);
      const cleanName = sanitizeOriginalName(f.originalname);
      const file = await saveFile(f.path, cleanName, f.mimetype, f.size, client_id);
      results.push(fileToResponse(file));
    } catch (err) {
      try { fs.unlinkSync(f.path); } catch {}
      if (!(err instanceof ValidationError)) {
        console.error(`Failed to process ${f.originalname}:`, err);
      }
      results.push({ error: err.message, original_name: f.originalname });
    }
  }

  if (isApiKey) {
    const minimal = results.map(r => r.error ? { error: r.error } : { cdn_url: r.cdn_url });
    return res.status(201).json(minimal);
  }
  res.status(201).json(results);
});

router.patch('/:id', requireSession, (req, res) => {
  const { client_id } = req.body;
  if (!client_id) {
    return res.status(400).json({ error: 'client_id required' });
  }
  const file = moveFile(req.params.id, client_id);
  if (!file) return res.status(404).json({ error: 'File or client not found' });
  res.json(fileToResponse(file));
});

router.post('/:id/replace', uploadLimiter, upload.single('file'), async (req, res) => {
  if (req.authMethod === 'api-key') {
    const existing = db.prepare('SELECT client_id FROM files WHERE id = ?').get(req.params.id);
    if (!existing) {
      cleanupTempFiles(req);
      return res.status(404).json({ error: 'File not found' });
    }
    if (existing.client_id !== req.apiKeyClientId) {
      cleanupTempFiles(req);
      return res.status(403).json({ error: 'Access denied' });
    }
  }
  if (!req.file) {
    return res.status(400).json({ error: 'File required' });
  }
  try {
    await validateUpload(req.file.path, req.file.originalname);
    const cleanName = sanitizeOriginalName(req.file.originalname);
    const file = await replaceFile(req.params.id, req.file.path, cleanName, req.file.mimetype, req.file.size);
    if (!file) return res.status(404).json({ error: 'File not found' });
    const response = fileToResponse(file);
    if (req.authMethod === 'api-key') {
      return res.json({ cdn_url: response.cdn_url });
    }
    res.json(response);
  } catch (err) {
    try { fs.unlinkSync(req.file.path); } catch {}
    if (err instanceof ValidationError) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error('Replace failed:', err);
    return res.status(500).json({ error: 'Internal error during replace' });
  }
});

async function handleCoverGeneration(req, res, format, width, height) {
  const file = db.prepare('SELECT * FROM files WHERE id = ?').get(req.params.id);
  if (!file) return res.status(404).json({ error: 'File not found' });
  if (req.authMethod === 'api-key' && file.client_id !== req.apiKeyClientId) {
    return res.status(403).json({ error: 'Access denied' });
  }
  if (file.type !== 'image') {
    return res.status(400).json({ error: 'Source file must be an image' });
  }

  const brand = getBranding(file.client_id);
  if (!brand.formats.includes(format)) {
    return res.status(400).json({ error: `Format '${format}' not supported for this client` });
  }

  const sourcePath = path.join(config.MEDIA_FILES_PATH, `${file.id}.${file.extension}`);
  const sourceBuffer = fs.readFileSync(sourcePath);
  const coverBuffer = await generateCover({ sourceBuffer, data: req.body, width, height, clientId: file.client_id });

  const tmpPath = path.join('/tmp/luna-visor-uploads/', `${format}-${file.id}.webp`);
  fs.writeFileSync(tmpPath, coverBuffer);
  const coverName = `${format}-${file.original_name.replace(/\.[^.]+$/, '')}.webp`;
  const saved = await saveFile(tmpPath, coverName, 'image/webp', coverBuffer.length, file.client_id);

  const response = fileToResponse(saved);
  if (req.authMethod === 'api-key') {
    return res.status(201).json({ cdn_url: response.cdn_url });
  }
  res.status(201).json(response);
}

router.post('/:id/story', coverLimiter, (req, res) => handleCoverGeneration(req, res, 'story', 1080, 1920));
router.post('/:id/cover', coverLimiter, (req, res) => handleCoverGeneration(req, res, 'cover', 1080, 1350));
router.post('/:id/square', coverLimiter, (req, res) => handleCoverGeneration(req, res, 'square', 1080, 1080));
router.post('/:id/fb', coverLimiter, (req, res) => handleCoverGeneration(req, res, 'fb', 1080, 1080));

router.delete('/:id', (req, res) => {
  // API key: verify file belongs to the key's client
  if (req.authMethod === 'api-key') {
    const file = db.prepare('SELECT client_id FROM files WHERE id = ?').get(req.params.id);
    if (!file) return res.status(404).json({ error: 'File not found' });
    if (file.client_id !== req.apiKeyClientId) {
      return res.status(403).json({ error: 'Access denied' });
    }
  }
  const file = deleteFile(req.params.id);
  if (!file) return res.status(404).json({ error: 'File not found' });
  res.json({ ok: true });
});

router.post('/:id/copy', requireSession, async (req, res) => {
  const { client_id } = req.body;
  if (!client_id) {
    return res.status(400).json({ error: 'client_id required' });
  }
  const file = await copyFile(req.params.id, client_id);
  if (!file) return res.status(404).json({ error: 'File or client not found' });
  res.status(201).json(fileToResponse(file));
});

router.post('/scan-references', requireSession, (_req, res) => {
  const { scanReferences } = require('../services/log-scanner');
  const count = scanReferences();
  res.json({ ok: true, newly_referenced: count });
});

module.exports = router;
