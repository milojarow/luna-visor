const path = require('path');
const fs = require('fs');

const SCRATCH_BASE = process.env.SCRATCHPAD
  || path.join(require('os').tmpdir(), 'luna-visor-tests');
const scratch = path.join(SCRATCH_BASE, 'luna-tests', 'caller-scope');
fs.rmSync(scratch, { recursive: true, force: true });
fs.mkdirSync(path.join(scratch, 'db'), { recursive: true });
fs.mkdirSync(path.join(scratch, 'files'), { recursive: true });
process.env.MEDIA_PATH = scratch;
process.env.SESSION_SECRET = 'test';
process.env.ADMIN_PASSWORD_HASH = 'test';
process.env.CDN_BASE_URL = 'http://localhost';

const { test } = require('node:test');
const assert = require('node:assert');
require('../src/db/connection');
const { callerScope } = require('../src/middleware/auth');

test('callerScope: owner session is unrestricted', () => {
  assert.strictEqual(callerScope({ authMethod: 'session' }), null);
});

test('callerScope: admin key is unrestricted (writes are stopped by the barrier)', () => {
  assert.strictEqual(callerScope({ authMethod: 'api-key', isAdminKey: true }), null);
});

test('callerScope: client key is pinned to its own vault', () => {
  assert.deepStrictEqual(
    callerScope({ authMethod: 'api-key', isAdminKey: false, apiKeyClientId: 7 }),
    [7],
  );
});

test('callerScope: an unknown identity sees nothing, not everything', () => {
  assert.deepStrictEqual(callerScope({}), []);
  assert.deepStrictEqual(callerScope({ authMethod: 'something-new' }), []);
});

// ---------------------------------------------------------------------------
// Regression: the refactor's success criterion is that nothing changed for the
// identities that already existed. These run against a real Express app wired
// in the same order as server.js.
// ---------------------------------------------------------------------------
const crypto = require('crypto');
const express = require('express');
const db = require('../src/db/connection');
const { requireAuth } = require('../src/middleware/auth');

const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const RAW_CLIENT = 'raw-client-key-caller-scope';
const RAW_ADMIN = 'raw-admin-key-caller-scope';

const c1 = db.prepare("INSERT INTO clients (name, slug) VALUES ('c1','c1')").run().lastInsertRowid;
const c2 = db.prepare("INSERT INTO clients (name, slug) VALUES ('c2','c2')").run().lastInsertRowid;
db.prepare("INSERT INTO api_keys (name, key_hash, key_preview, client_id, is_admin) VALUES ('ck', ?, 'aaaa', ?, 0)").run(sha(RAW_CLIENT), c1);
db.prepare("INSERT INTO api_keys (name, key_hash, key_preview, client_id, is_admin) VALUES ('ak', ?, 'bbbb', NULL, 1)").run(sha(RAW_ADMIN));
for (const [id, cid] of [['f1', c1], ['f2', c2]]) {
  db.prepare(`INSERT INTO files (id, original_name, extension, mime_type, size_bytes, client_id, type)
              VALUES (?, ?, 'webp', 'image/webp', 10, ?, 'image')`).run(id, id, cid);
}

const app = express();
app.use(express.json());
// Stand-in for express-session: the owner's path can't be exercised against
// the live service (it sits behind Caddy basic_auth), so it gets covered here.
app.use((req, _res, next) => {
  if (req.headers['x-test-session']) req.session = { authenticated: true };
  next();
});
app.use(requireAuth);
app.use('/api/files', require('../src/routes/files'));

async function get(pathname, headers = {}) {
  const server = app.listen(0);
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}${pathname}`, { headers });
    const body = await res.json().catch(() => null);
    return { status: res.status, body };
  } finally {
    server.close();
  }
}

test('regression: a client key still sees only its own vault', async () => {
  const { status, body } = await get('/api/files', { 'X-API-Key': RAW_CLIENT });
  assert.strictEqual(status, 200);
  assert.deepStrictEqual(body.map(f => f.id), ['f1']);
});

test('regression: a client key asking for its own vault explicitly still works', async () => {
  const { status, body } = await get(`/api/files?client_id=${c1}`, { 'X-API-Key': RAW_CLIENT });
  assert.strictEqual(status, 200);
  assert.deepStrictEqual(body.map(f => f.id), ['f1']);
});

test('regression: a client key asking for a foreign vault still gets 403', async () => {
  const { status } = await get(`/api/files?client_id=${c2}`, { 'X-API-Key': RAW_CLIENT });
  assert.strictEqual(status, 403);
});

test('regression: a client key still cannot read a foreign file by id', async () => {
  const { status } = await get('/api/files/f2', { 'X-API-Key': RAW_CLIENT });
  assert.strictEqual(status, 403);
});

test('regression: a client key still gets the curated projection, no attribution', async () => {
  const { body } = await get('/api/files', { 'X-API-Key': RAW_CLIENT });
  assert.ok(!('api_key_name' in body[0]));
  assert.ok('cdn_url' in body[0]);
});

test('regression: an admin key still reads across all clients', async () => {
  const { status, body } = await get('/api/files', { 'X-API-Key': RAW_ADMIN });
  assert.strictEqual(status, 200);
  assert.strictEqual(body.length, 2);
  assert.ok('client_name' in body[0]);
});

test('regression: an admin key still reads any single file', async () => {
  const { status } = await get('/api/files/f2', { 'X-API-Key': RAW_ADMIN });
  assert.strictEqual(status, 200);
});

test('regression: an invalid key is still 401', async () => {
  const { status } = await get('/api/files', { 'X-API-Key': 'garbage' });
  assert.strictEqual(status, 401);
});

test('regression: the owner session still sees every file', async () => {
  const { status, body } = await get('/api/files', { 'x-test-session': '1' });
  assert.strictEqual(status, 200);
  assert.strictEqual(body.length, 2);
});

test('regression: the owner session still gets upload attribution', async () => {
  const { body } = await get('/api/files', { 'x-test-session': '1' });
  assert.ok('api_key_name' in body[0], 'attribution is the owner-only field');
  assert.ok('api_key_revoked_at' in body[0]);
});

test('regression: the owner session can still scope with ?client_id=', async () => {
  const { status, body } = await get(`/api/files?client_id=${c2}`, { 'x-test-session': '1' });
  assert.strictEqual(status, 200);
  assert.deepStrictEqual(body.map(f => f.id), ['f2']);
});
