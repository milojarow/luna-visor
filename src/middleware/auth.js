const crypto = require('crypto');
const db = require('../db/connection');

const publicPaths = ['/api/auth/login', '/api/auth/status', '/login.html'];

const findApiKey = db.prepare('SELECT client_id FROM api_keys WHERE key_hash = ?');

function requireAuth(req, res, next) {
  if (publicPaths.includes(req.path)) return next();
  if (req.path === '/login.html' || req.path === '/favicon.ico') return next();

  // API key authentication
  const apiKey = req.headers['x-api-key'];
  if (apiKey) {
    const hash = crypto.createHash('sha256').update(apiKey).digest('hex');
    const row = findApiKey.get(hash);
    if (!row) return res.status(401).json({ error: 'Invalid API key' });
    req.authMethod = 'api-key';
    req.apiKeyClientId = row.client_id;
    return next();
  }

  // Session authentication
  if (!req.session || !req.session.authenticated) {
    if (req.path.startsWith('/api/')) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    return res.redirect('/login.html');
  }
  req.authMethod = 'session';
  next();
}

function requireSession(req, res, next) {
  if (req.authMethod !== 'session') {
    return res.status(403).json({ error: 'Session authentication required' });
  }
  next();
}

module.exports = { requireAuth, requireSession };
