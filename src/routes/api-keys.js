const { Router } = require('express');
const crypto = require('crypto');
const db = require('../db/connection');
const { requireSession, requireSessionOrAdmin } = require('../middleware/auth');

const router = Router();

router.get('/', requireSessionOrAdmin, (_req, res) => {
  const keys = db.prepare(`
    SELECT ak.id, ak.name, ak.key_preview, ak.client_id, ak.is_admin, c.name as client_name, ak.created_at, ak.revoked_at
    FROM api_keys ak
    LEFT JOIN clients c ON c.id = ak.client_id
    ORDER BY (ak.revoked_at IS NOT NULL), ak.created_at DESC
  `).all();
  res.json(keys);
});

router.post('/', requireSessionOrAdmin, (req, res) => {
  const { name, client_id, is_admin } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Name required' });
  }

  let client = null;
  if (is_admin) {
    if (req.authMethod !== 'session') {
      return res.status(403).json({ error: 'Admin keys can only be created from the WUI (session)' });
    }
    if (client_id) {
      return res.status(400).json({ error: 'Admin keys take no client_id' });
    }
  } else {
    if (!client_id) {
      return res.status(400).json({ error: 'client_id required' });
    }
    client = db.prepare('SELECT * FROM clients WHERE id = ?').get(client_id);
    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }
  }

  const rawKey = crypto.randomBytes(32).toString('hex');
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
  const keyPreview = rawKey.slice(-4);

  const result = db.prepare(
    'INSERT INTO api_keys (name, key_hash, key_preview, client_id, is_admin) VALUES (?, ?, ?, ?, ?)'
  ).run(name.trim(), keyHash, keyPreview, is_admin ? null : client_id, is_admin ? 1 : 0);

  res.status(201).json({
    id: result.lastInsertRowid,
    name: name.trim(),
    key: rawKey,
    key_preview: keyPreview,
    client_id: is_admin ? null : client_id,
    client_name: is_admin ? null : client.name,
    is_admin: is_admin ? 1 : 0,
  });
});

router.patch('/:id', requireSession, (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'name required' });
  }
  const result = db.prepare('UPDATE api_keys SET name = ? WHERE id = ?')
    .run(name.trim(), req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'API key not found' });
  res.json({ ok: true });
});

router.delete('/:id', requireSession, (req, res) => {
  const result = db.prepare(
    "UPDATE api_keys SET revoked_at = datetime('now') WHERE id = ? AND revoked_at IS NULL"
  ).run(req.params.id);
  if (result.changes === 0) {
    return res.status(404).json({ error: 'API key not found or already revoked' });
  }
  res.json({ ok: true });
});

module.exports = router;
