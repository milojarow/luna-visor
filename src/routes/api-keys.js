const { Router } = require('express');
const crypto = require('crypto');
const db = require('../db/connection');

const router = Router();

router.get('/', (_req, res) => {
  const keys = db.prepare(`
    SELECT ak.id, ak.name, ak.key_preview, ak.client_id, c.name as client_name, ak.created_at
    FROM api_keys ak
    JOIN clients c ON c.id = ak.client_id
    ORDER BY ak.created_at DESC
  `).all();
  res.json(keys);
});

router.post('/', (req, res) => {
  const { name, client_id } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Name required' });
  }
  if (!client_id) {
    return res.status(400).json({ error: 'client_id required' });
  }

  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(client_id);
  if (!client) {
    return res.status(404).json({ error: 'Client not found' });
  }

  const rawKey = crypto.randomBytes(32).toString('hex');
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
  const keyPreview = rawKey.slice(-4);

  const result = db.prepare(
    'INSERT INTO api_keys (name, key_hash, key_preview, client_id) VALUES (?, ?, ?, ?)'
  ).run(name.trim(), keyHash, keyPreview, client_id);

  res.status(201).json({
    id: result.lastInsertRowid,
    name: name.trim(),
    key: rawKey,
    key_preview: keyPreview,
    client_id,
    client_name: client.name,
  });
});

router.delete('/:id', (req, res) => {
  const result = db.prepare('DELETE FROM api_keys WHERE id = ?').run(req.params.id);
  if (result.changes === 0) {
    return res.status(404).json({ error: 'API key not found' });
  }
  res.json({ ok: true });
});

module.exports = router;
