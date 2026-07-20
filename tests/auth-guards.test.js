const path = require('path');
const fs = require('fs');

const SCRATCH_BASE = process.env.SCRATCHPAD
  || '/tmp/claude-1001/-home-endymion/690fc0c6-9674-486e-971d-2e5e1fdc07a5/scratchpad';
const scratch = path.join(SCRATCH_BASE, 'luna-tests', 'auth-guards');
fs.rmSync(scratch, { recursive: true, force: true });
fs.mkdirSync(path.join(scratch, 'db'), { recursive: true });
process.env.MEDIA_PATH = scratch;
process.env.SESSION_SECRET = 'test';
process.env.ADMIN_PASSWORD_HASH = 'test';
process.env.CDN_BASE_URL = 'http://localhost';

const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const db = require('../src/db/connection');
const { requireAuth, requireSession, requireSessionOrAdmin, blockAdminKeys } = require('../src/middleware/auth');

// Seed: one client, one client key, one admin key, one revoked admin key.
const RAW = {
  client: 'raw-client-key',
  admin: 'raw-admin-key',
  revoked: 'raw-revoked-admin-key',
};
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
db.prepare("INSERT INTO clients (name, slug) VALUES ('c1', 'c1')").run();
db.prepare("INSERT INTO api_keys (name, key_hash, key_preview, client_id, is_admin) VALUES ('ck', ?, 'aaaa', 1, 0)").run(sha(RAW.client));
db.prepare("INSERT INTO api_keys (name, key_hash, key_preview, client_id, is_admin) VALUES ('ak', ?, 'bbbb', NULL, 1)").run(sha(RAW.admin));
db.prepare("INSERT INTO api_keys (name, key_hash, key_preview, client_id, is_admin, revoked_at) VALUES ('rk', ?, 'cccc', NULL, 1, datetime('now'))").run(sha(RAW.revoked));

function mockReq(headers = {}, extra = {}) {
  return { headers, path: '/api/clients', session: null, ...extra };
}
function mockRes() {
  const r = { statusCode: null, body: null };
  r.status = c => { r.statusCode = c; return r; };
  r.json = b => { r.body = b; return r; };
  return r;
}
function runMw(mw, req) {
  const res = mockRes();
  let nexted = false;
  mw(req, res, () => { nexted = true; });
  return { res, nexted };
}

test('requireAuth: admin key sets isAdminKey=true, apiKeyClientId=null', () => {
  const req = mockReq({ 'x-api-key': RAW.admin });
  const { nexted } = runMw(requireAuth, req);
  assert.ok(nexted);
  assert.strictEqual(req.authMethod, 'api-key');
  assert.strictEqual(req.isAdminKey, true);
  assert.strictEqual(req.apiKeyClientId, null);
});

test('requireAuth: client key sets isAdminKey=false, apiKeyClientId set', () => {
  const req = mockReq({ 'x-api-key': RAW.client });
  const { nexted } = runMw(requireAuth, req);
  assert.ok(nexted);
  assert.strictEqual(req.isAdminKey, false);
  assert.strictEqual(req.apiKeyClientId, 1);
});

test('requireAuth: revoked admin key gets 401', () => {
  const req = mockReq({ 'x-api-key': RAW.revoked });
  const { res, nexted } = runMw(requireAuth, req);
  assert.strictEqual(nexted, false);
  assert.strictEqual(res.statusCode, 401);
});

test('requireSessionOrAdmin: session passes', () => {
  const { nexted } = runMw(requireSessionOrAdmin, { authMethod: 'session' });
  assert.ok(nexted);
});

test('requireSessionOrAdmin: admin key passes', () => {
  const { nexted } = runMw(requireSessionOrAdmin, { authMethod: 'api-key', isAdminKey: true });
  assert.ok(nexted);
});

test('requireSessionOrAdmin: client key gets 403', () => {
  const { res, nexted } = runMw(requireSessionOrAdmin, { authMethod: 'api-key', isAdminKey: false });
  assert.strictEqual(nexted, false);
  assert.strictEqual(res.statusCode, 403);
  assert.strictEqual(res.body.error, 'Session or admin API key required');
});

test('blockAdminKeys: admin key gets 403', () => {
  const { res, nexted } = runMw(blockAdminKeys, { authMethod: 'api-key', isAdminKey: true });
  assert.strictEqual(nexted, false);
  assert.strictEqual(res.statusCode, 403);
  assert.strictEqual(res.body.error, 'Admin keys cannot access file endpoints; use a client-scoped key');
});

test('blockAdminKeys: client key and session pass', () => {
  assert.ok(runMw(blockAdminKeys, { authMethod: 'api-key', isAdminKey: false }).nexted);
  assert.ok(runMw(blockAdminKeys, { authMethod: 'session' }).nexted);
});

test('requireSession: admin key still 403 (destructive stays session-only)', () => {
  const { res, nexted } = runMw(requireSession, { authMethod: 'api-key', isAdminKey: true });
  assert.strictEqual(nexted, false);
  assert.strictEqual(res.statusCode, 403);
});
