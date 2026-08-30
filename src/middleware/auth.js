const crypto = require('crypto');
const db = require('../db/connection');

const publicPaths = ['/api/auth/login', '/api/auth/status', '/api/openapi.json', '/login.html', '/socios', '/api/partner/login'];

const findApiKey = db.prepare('SELECT id, client_id, is_admin FROM api_keys WHERE key_hash = ? AND revoked_at IS NULL');

const findPartner = db.prepare('SELECT id FROM partners WHERE id = ? AND disabled_at IS NULL');

// A partner reaches exactly the clients its live, non-admin keys point at.
// MIN(id) makes the choice deterministic when a partner holds two live keys
// for the same client.
const findPartnerScope = db.prepare(`
  SELECT MIN(k.id) AS api_key_id, k.client_id
  FROM api_keys k
  JOIN clients c ON c.id = k.client_id
  WHERE k.partner_id = ? AND k.revoked_at IS NULL AND k.is_admin = 0
  GROUP BY k.client_id
`);

function partnerScope(partnerId) {
  return findPartnerScope.all(partnerId);
}

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
    req.apiKeyId = row.id;
    req.apiKeyClientId = row.client_id;
    req.isAdminKey = row.is_admin === 1;
    return next();
  }

  // Partner session. Deliberately BEFORE the admin branch: a session that
  // somehow carried both flags lands on the path with less power.
  // The password authenticates; the api key still authorizes — so every
  // ownership check downstream keeps working off a real key id.
  if (req.session && req.session.partnerId) {
    if (!findPartner.get(req.session.partnerId)) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    const rows = partnerScope(req.session.partnerId);
    req.authMethod = 'partner';
    req.partnerId = req.session.partnerId;
    req.scopeClientIds = rows.map(r => r.client_id);
    req.partnerKeyByClient = Object.fromEntries(rows.map(r => [r.client_id, r.api_key_id]));
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

function requireSessionOrAdmin(req, res, next) {
  if (req.authMethod === 'session') return next();
  if (req.authMethod === 'api-key' && req.isAdminKey) return next();
  return res.status(403).json({ error: 'Session or admin API key required' });
}

// The client list is the partner's sidebar, so it admits partners too.
// Client-scoped keys stay out, exactly as before.
function requireClientListAccess(req, res, next) {
  if (req.authMethod === 'session') return next();
  if (req.authMethod === 'partner') return next();
  if (req.authMethod === 'api-key' && req.isAdminKey) return next();
  return res.status(403).json({ error: 'Session, admin API key or partner required' });
}

function blockAdminKeys(req, res, next) {
  if (req.authMethod === 'api-key' && req.isAdminKey) {
    return res.status(403).json({ error: 'Admin keys cannot access file endpoints; use a client-scoped key' });
  }
  next();
}

// Which client_ids may this caller touch?
//   null  → unrestricted (owner session; admin keys for reads — their writes
//           are already stopped by the blockAdminKeys barrier in files.js)
//   array → exactly these client_ids
// An identity nobody taught this function about gets [] — it sees nothing
// rather than everything. Same fail-closed discipline as the barrier.
function callerScope(req) {
  if (req.authMethod === 'session') return null;
  if (req.authMethod === 'partner') return req.scopeClientIds || [];
  if (req.authMethod === 'api-key') {
    return req.isAdminKey ? null : [req.apiKeyClientId];
  }
  return [];
}

module.exports = {
  requireAuth,
  requireSession,
  requireSessionOrAdmin,
  requireClientListAccess,
  blockAdminKeys,
  callerScope,
  partnerScope,
};
