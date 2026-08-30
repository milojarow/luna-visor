const path = require('path');
const fs = require('fs');

const SCRATCH_BASE = process.env.SCRATCHPAD
  || path.join(require('os').tmpdir(), 'luna-visor-tests');
const scratch = path.join(SCRATCH_BASE, 'luna-tests', 'partner-identity');
fs.rmSync(scratch, { recursive: true, force: true });
fs.mkdirSync(path.join(scratch, 'db'), { recursive: true });
fs.mkdirSync(path.join(scratch, 'files'), { recursive: true });
process.env.MEDIA_PATH = scratch;
process.env.SESSION_SECRET = 'test';
process.env.ADMIN_PASSWORD_HASH = 'test';
process.env.CDN_BASE_URL = 'http://localhost';

const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const db = require('../src/db/connection');
const { requireAuth, callerScope, partnerScope } = require('../src/middleware/auth');

const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const cA = db.prepare("INSERT INTO clients (name, slug) VALUES ('a','a')").run().lastInsertRowid;
const cB = db.prepare("INSERT INTO clients (name, slug) VALUES ('b','b')").run().lastInsertRowid;
const cC = db.prepare("INSERT INTO clients (name, slug) VALUES ('c','c')").run().lastInsertRowid;
const pid = db.prepare("INSERT INTO partners (name, password_hash) VALUES ('p1','x')").run().lastInsertRowid;

const keyA = db.prepare("INSERT INTO api_keys (name, key_hash, key_preview, client_id, is_admin, partner_id) VALUES ('ka', ?, 'aaaa', ?, 0, ?)").run(sha('ka'), cA, pid).lastInsertRowid;
const keyB = db.prepare("INSERT INTO api_keys (name, key_hash, key_preview, client_id, is_admin, partner_id) VALUES ('kb', ?, 'bbbb', ?, 0, ?)").run(sha('kb'), cB, pid).lastInsertRowid;
// revoked → must not grant anything
db.prepare("INSERT INTO api_keys (name, key_hash, key_preview, client_id, is_admin, partner_id, revoked_at) VALUES ('kc', ?, 'cccc', ?, 0, ?, datetime('now'))").run(sha('kc'), cC, pid);
// an admin key hung on a partner must never widen its scope
db.prepare("INSERT INTO api_keys (name, key_hash, key_preview, client_id, is_admin, partner_id) VALUES ('kadm', ?, 'dddd', NULL, 1, ?)").run(sha('kadm'), pid);

function mockRes() {
  const r = { statusCode: null, body: null };
  r.status = c => { r.statusCode = c; return r; };
  r.json = b => { r.body = b; return r; };
  r.redirect = () => { r.statusCode = 302; return r; };
  return r;
}
function runMw(mw, req) {
  const res = mockRes();
  let nexted = false;
  mw(req, res, () => { nexted = true; });
  return { res, nexted };
}
const partnerReq = id => ({ headers: {}, path: '/api/files', session: { partnerId: id } });

test('partnerScope: live client keys only — revoked and admin keys excluded', () => {
  const rows = partnerScope(pid);
  assert.deepStrictEqual(rows.map(r => r.client_id).sort((x, y) => x - y), [cA, cB]);
  assert.deepStrictEqual(
    rows.map(r => r.api_key_id).sort((x, y) => x - y),
    [keyA, keyB].sort((x, y) => x - y),
  );
});

test('requireAuth: a partner session becomes authMethod=partner with its vaults', () => {
  const req = partnerReq(pid);
  const { nexted } = runMw(requireAuth, req);
  assert.ok(nexted);
  assert.strictEqual(req.authMethod, 'partner');
  assert.strictEqual(req.partnerId, pid);
  assert.deepStrictEqual(req.scopeClientIds.sort((x, y) => x - y), [cA, cB]);
  assert.strictEqual(req.partnerKeyByClient[cA], keyA);
  assert.strictEqual(req.partnerKeyByClient[cB], keyB);
});

test('requireAuth: a partner never gets an api key identity of its own', () => {
  const req = partnerReq(pid);
  runMw(requireAuth, req);
  assert.strictEqual(req.isAdminKey, undefined);
  assert.strictEqual(req.apiKeyClientId, undefined);
});

test('callerScope: a partner is scoped to its vaults', () => {
  const req = partnerReq(pid);
  runMw(requireAuth, req);
  assert.deepStrictEqual(callerScope(req).sort((x, y) => x - y), [cA, cB]);
});

test('a partner with no live keys sees nothing — not everything', () => {
  const empty = db.prepare("INSERT INTO partners (name, password_hash) VALUES ('empty','x')").run().lastInsertRowid;
  const req = partnerReq(empty);
  runMw(requireAuth, req);
  assert.strictEqual(req.authMethod, 'partner');
  assert.deepStrictEqual(callerScope(req), []);
});

test('a disabled partner is not an identity at all', () => {
  const off = db.prepare("INSERT INTO partners (name, password_hash, disabled_at) VALUES ('off','x', datetime('now'))").run().lastInsertRowid;
  db.prepare("INSERT INTO api_keys (name, key_hash, key_preview, client_id, is_admin, partner_id) VALUES ('koff', ?, 'eeee', ?, 0, ?)").run(sha('koff'), cA, off);
  const { res, nexted } = runMw(requireAuth, partnerReq(off));
  assert.ok(!nexted);
  assert.strictEqual(res.statusCode, 401);
});

test('a session carrying both flags takes the lower-power path', () => {
  const req = { headers: {}, path: '/api/files', session: { partnerId: pid, authenticated: true } };
  runMw(requireAuth, req);
  assert.strictEqual(req.authMethod, 'partner');
});

test('an X-API-Key still wins over a partner cookie — keys are unaffected', () => {
  const req = { headers: { 'x-api-key': 'ka' }, path: '/api/files', session: { partnerId: pid } };
  runMw(requireAuth, req);
  assert.strictEqual(req.authMethod, 'api-key');
  assert.strictEqual(req.apiKeyClientId, cA);
});

test('revoking a key drops that vault from the partner scope immediately', () => {
  db.prepare('UPDATE api_keys SET revoked_at = datetime(\'now\') WHERE id = ?').run(keyB);
  const req = partnerReq(pid);
  runMw(requireAuth, req);
  assert.deepStrictEqual(req.scopeClientIds, [cA]);
  db.prepare('UPDATE api_keys SET revoked_at = NULL WHERE id = ?').run(keyB);
});
