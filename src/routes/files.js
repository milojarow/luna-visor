const { Router } = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const db = require('../db/connection');
const config = require('../config');
const { saveFile, deleteFile, moveFile, copyFile, replaceFile } = require('../services/file-manager');
const { generateCover, getBranding } = require('../services/cover-generator');
const { requireSession } = require('../middleware/auth');

const upload = multer({
  dest: '/tmp/luna-visor-uploads/',
  limits: { fileSize: 500 * 1024 * 1024 },
});

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

router.post('/upload', upload.array('files', 20), async (req, res) => {
  const isApiKey = req.authMethod === 'api-key';
  const client_id = isApiKey ? req.apiKeyClientId : req.body.client_id;

  if (!client_id) {
    return res.status(400).json({ error: 'client_id required' });
  }

  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(client_id);
  if (!client) {
    return res.status(404).json({ error: 'Client not found' });
  }

  const results = [];
  for (const f of req.files) {
    try {
      const file = await saveFile(f.path, f.originalname, f.mimetype, f.size, client_id);
      results.push(fileToResponse(file));
    } catch (err) {
      console.error(`Failed to process ${f.originalname}:`, err);
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

router.post('/:id/replace', upload.single('file'), async (req, res) => {
  // API key: verify file belongs to the key's client
  if (req.authMethod === 'api-key') {
    const existing = db.prepare('SELECT client_id FROM files WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'File not found' });
    if (existing.client_id !== req.apiKeyClientId) {
      return res.status(403).json({ error: 'Access denied' });
    }
  }
  if (!req.file) {
    return res.status(400).json({ error: 'File required' });
  }
  const file = await replaceFile(req.params.id, req.file.path, req.file.originalname, req.file.mimetype, req.file.size);
  if (!file) return res.status(404).json({ error: 'File not found' });
  const response = fileToResponse(file);
  if (req.authMethod === 'api-key') {
    return res.json({ cdn_url: response.cdn_url });
  }
  res.json(response);
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

  const tmpPath = path.join('/tmp/luna-visor-uploads/', `${format}-${file.id}.jpg`);
  fs.writeFileSync(tmpPath, coverBuffer);
  const coverName = `${format}-${file.original_name.replace(/\.[^.]+$/, '')}.jpg`;
  const saved = await saveFile(tmpPath, coverName, 'image/jpeg', coverBuffer.length, file.client_id);

  const response = fileToResponse(saved);
  if (req.authMethod === 'api-key') {
    return res.status(201).json({ cdn_url: response.cdn_url });
  }
  res.status(201).json(response);
}

router.post('/:id/story', (req, res) => handleCoverGeneration(req, res, 'story', 1080, 1920));
router.post('/:id/cover', (req, res) => handleCoverGeneration(req, res, 'cover', 1080, 1350));
router.post('/:id/square', (req, res) => handleCoverGeneration(req, res, 'square', 1080, 1080));
router.post('/:id/fb', (req, res) => handleCoverGeneration(req, res, 'fb', 1080, 1080));

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
