const { Router } = require('express');
const db = require('../db/connection');

const router = Router();

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

router.get('/', (_req, res) => {
  const clients = db.prepare(`
    SELECT c.*, COUNT(f.id) as file_count
    FROM clients c
    LEFT JOIN files f ON f.client_id = c.id
    GROUP BY c.id
    ORDER BY c.name
  `).all();
  res.json(clients);
});

router.post('/', (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Name required' });
  }
  const slug = slugify(name.trim());
  try {
    const result = db.prepare('INSERT INTO clients (name, slug) VALUES (?, ?)').run(name.trim(), slug);
    const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(client);
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'Client already exists' });
    }
    throw err;
  }
});

router.patch('/:id', (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Name required' });
  }
  const slug = slugify(name.trim());
  const result = db.prepare('UPDATE clients SET name = ?, slug = ? WHERE id = ?').run(name.trim(), slug, req.params.id);
  if (result.changes === 0) {
    return res.status(404).json({ error: 'Client not found' });
  }
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
  res.json(client);
});

router.delete('/:id', (req, res) => {
  const apiKeyCount = db.prepare('SELECT COUNT(*) as count FROM api_keys WHERE client_id = ?').get(req.params.id);
  if (apiKeyCount && apiKeyCount.count > 0) {
    return res.status(409).json({ error: `Client has ${apiKeyCount.count} API key(s). Revoke them first.` });
  }
  const fileCount = db.prepare('SELECT COUNT(*) as count FROM files WHERE client_id = ?').get(req.params.id);
  if (fileCount && fileCount.count > 0) {
    return res.status(409).json({ error: `Client has ${fileCount.count} files. Move or delete them first.` });
  }
  const result = db.prepare('DELETE FROM clients WHERE id = ?').run(req.params.id);
  if (result.changes === 0) {
    return res.status(404).json({ error: 'Client not found' });
  }
  res.json({ ok: true });
});

module.exports = router;
