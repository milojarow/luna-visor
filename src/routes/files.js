const { Router } = require('express');
const multer = require('multer');
const db = require('../db/connection');
const config = require('../config');
const { saveFile, deleteFile, moveFile, copyFile } = require('../services/file-manager');

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

router.get('/', (req, res) => {
  const { client_id } = req.query;
  let files;
  if (client_id) {
    files = db.prepare('SELECT * FROM files WHERE client_id = ? ORDER BY created_at DESC').all(client_id);
  } else {
    files = db.prepare('SELECT * FROM files ORDER BY created_at DESC').all();
  }
  res.json(files.map(fileToResponse));
});

router.get('/:id', (req, res) => {
  const file = db.prepare('SELECT * FROM files WHERE id = ?').get(req.params.id);
  if (!file) return res.status(404).json({ error: 'File not found' });
  res.json(fileToResponse(file));
});

router.post('/upload', upload.array('files', 20), async (req, res) => {
  const { client_id } = req.body;
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

  res.status(201).json(results);
});

router.patch('/:id', (req, res) => {
  const { client_id } = req.body;
  if (!client_id) {
    return res.status(400).json({ error: 'client_id required' });
  }
  const file = moveFile(req.params.id, client_id);
  if (!file) return res.status(404).json({ error: 'File or client not found' });
  res.json(fileToResponse(file));
});

router.delete('/:id', (req, res) => {
  const file = deleteFile(req.params.id);
  if (!file) return res.status(404).json({ error: 'File not found' });
  res.json({ ok: true });
});

router.post('/:id/copy', async (req, res) => {
  const { client_id } = req.body;
  if (!client_id) {
    return res.status(400).json({ error: 'client_id required' });
  }
  const file = await copyFile(req.params.id, client_id);
  if (!file) return res.status(404).json({ error: 'File or client not found' });
  res.status(201).json(fileToResponse(file));
});

router.post('/scan-references', (_req, res) => {
  const { scanReferences } = require('../services/log-scanner');
  const count = scanReferences();
  res.json({ ok: true, newly_referenced: count });
});

module.exports = router;
