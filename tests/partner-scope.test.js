const path = require('path');
const fs = require('fs');

const SCRATCH_BASE = process.env.SCRATCHPAD
  || path.join(require('os').tmpdir(), 'luna-visor-tests');
const scratch = path.join(SCRATCH_BASE, 'luna-tests', 'partner-scope');
fs.rmSync(scratch, { recursive: true, force: true });
fs.mkdirSync(path.join(scratch, 'db'), { recursive: true });
fs.mkdirSync(path.join(scratch, 'files'), { recursive: true });
process.env.MEDIA_PATH = scratch;
process.env.SESSION_SECRET = 'test';
process.env.ADMIN_PASSWORD_HASH = 'test';
process.env.CDN_BASE_URL = 'http://localhost';

const { test, before } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const express = require('express');
const sharp = require('sharp');
const db = require('../src/db/connection');
const { requireAuth } = require('../src/middleware/auth');
const { saveFile } = require('../src/services/file-manager');

const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const RAW_CLIENT = 'raw-client-key-partner-scope';
const RAW_ADMIN = 'raw-admin-key-partner-scope';

// Two vaults belong to the partner, one does not.
const cA = db.prepare("INSERT INTO clients (name, slug) VALUES ('vault-a','vault-a')").run().lastInsertRowid;
const cB = db.prepare("INSERT INTO clients (name, slug) VALUES ('vault-b','vault-b')").run().lastInsertRowid;
const cC = db.prepare("INSERT INTO clients (name, slug) VALUES ('foreign','foreign')").run().lastInsertRowid;
const pid = db.prepare("INSERT INTO partners (name, password_hash) VALUES ('richie-test','x')").run().lastInsertRowid;

const keyA = db.prepare("INSERT INTO api_keys (name, key_hash, key_preview, client_id, is_admin, partner_id) VALUES ('ka', ?, 'aaaa', ?, 0, ?)").run(sha('ka'), cA, pid).lastInsertRowid;
const keyB = db.prepare("INSERT INTO api_keys (name, key_hash, key_preview, client_id, is_admin, partner_id) VALUES ('kb', ?, 'bbbb', ?, 0, ?)").run(sha('kb'), cB, pid).lastInsertRowid;
db.prepare("INSERT INTO api_keys (name, key_hash, key_preview, client_id, is_admin) VALUES ('ck', ?, 'cccc', ?, 0)").run(sha(RAW_CLIENT), cC);
db.prepare("INSERT INTO api_keys (name, key_hash, key_preview, client_id, is_admin) VALUES ('ak', ?, 'dddd', NULL, 1)").run(sha(RAW_ADMIN));

const app = express();
app.use(express.json());
// Stand-in for express-session — the identity under test is what requireAuth
// derives from the cookie, not the cookie plumbing (covered in partner-login).
app.use((req, _res, next) => {
  if (req.headers['x-test-partner']) req.session = { partnerId: Number(req.headers['x-test-partner']) };
  if (req.headers['x-test-session']) req.session = { authenticated: true };
  next();
});
app.use(requireAuth);
app.use('/api/clients', require('../src/routes/clients'));
app.use('/api/files', require('../src/routes/files'));

const AS_PARTNER = { 'x-test-partner': String(pid) };

async function call(method, pathname, { headers = {}, json, form } = {}) {
  const server = app.listen(0);
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}${pathname}`, {
      method,
      headers: json ? { 'Content-Type': 'application/json', ...headers } : headers,
      body: json ? JSON.stringify(json) : (form || undefined),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  } finally {
    server.close();
  }
}

let png;
let fileA;
let fileB;
let fileC;

before(async () => {
  png = await sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 10, g: 20, b: 30 } } })
    .png().toBuffer();
  const tmp = path.join(scratch, 'seed.png');
  const seed = async (clientId) => {
    fs.writeFileSync(tmp, png);
    const f = await saveFile(tmp, 'seed.png', 'image/png', png.length, clientId, null);
    return f.id;
  };
  fileA = await seed(cA);
  fileB = await seed(cB);
  fileC = await seed(cC);
});

// ---------------------------------------------------------------------------
// THE regression test for the fail-open that motivated this whole project.
// ---------------------------------------------------------------------------
test('a partner uploading with a foreign client_id never writes there', async () => {
  const before = db.prepare('SELECT COUNT(*) n FROM files WHERE client_id = ?').get(cC).n;

  const form = new FormData();
  form.append('client_id', String(cC));
  form.append('files', new Blob([png], { type: 'image/png' }), 'probe.png');
  const { status } = await call('POST', '/api/files/upload', { headers: AS_PARTNER, form });

  assert.strictEqual(status, 403, 'must be refused');
  const after = db.prepare('SELECT COUNT(*) n FROM files WHERE client_id = ?').get(cC).n;
  assert.strictEqual(after, before, 'the foreign vault must be byte-for-byte untouched');
});

test('a partner uploading to its own vault works and is attributed to its real key', async () => {
  const form = new FormData();
  form.append('client_id', String(cA));
  form.append('files', new Blob([png], { type: 'image/png' }), 'mine.png');
  const { status, body } = await call('POST', '/api/files/upload', { headers: AS_PARTNER, form });

  assert.strictEqual(status, 201);
  const row = db.prepare('SELECT client_id, api_key_id FROM files WHERE id = ?').get(body[0].id);
  assert.strictEqual(row.client_id, cA);
  assert.strictEqual(row.api_key_id, keyA, 'attribution must point at the key that granted the vault');
});

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------
test('partner: GET /api/files is the union of its vaults and nothing else', async () => {
  const { status, body } = await call('GET', '/api/files', { headers: AS_PARTNER });
  assert.strictEqual(status, 200);
  const seen = [...new Set(body.map(f => f.client_id))].sort((x, y) => x - y);
  assert.deepStrictEqual(seen, [cA, cB]);
});

test('partner: the response drops attribution but keeps what the gallery needs', async () => {
  const { body } = await call('GET', '/api/files', { headers: AS_PARTNER });
  assert.ok(!('api_key_name' in body[0]), 'no attribution');
  assert.ok(!('api_key_id' in body[0]), 'no attribution');
  assert.ok(!('api_key_revoked_at' in body[0]), 'no attribution');
  for (const field of ['cdn_url', 'has_thumbnail', 'has_resized', 'referenced', 'client_is_ephemeral', 'type']) {
    assert.ok(field in body[0], `gallery needs ${field}`);
  }
});

test('partner: ?client_id= on a foreign vault is 403, not a silent re-scope', async () => {
  const { status } = await call('GET', `/api/files?client_id=${cC}`, { headers: AS_PARTNER });
  assert.strictEqual(status, 403);
});

test('partner: ?client_id= on its own vault narrows the list', async () => {
  const { status, body } = await call('GET', `/api/files?client_id=${cB}`, { headers: AS_PARTNER });
  assert.strictEqual(status, 200);
  assert.ok(body.every(f => f.client_id === cB));
});

test('partner: reading a foreign file by id is 403', async () => {
  const { status } = await call('GET', `/api/files/${fileC}`, { headers: AS_PARTNER });
  assert.strictEqual(status, 403);
});

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------
test('partner: deleting a foreign file is 403 and the file survives', async () => {
  const { status } = await call('DELETE', `/api/files/${fileC}`, { headers: AS_PARTNER });
  assert.strictEqual(status, 403);
  assert.ok(db.prepare('SELECT 1 FROM files WHERE id = ?').get(fileC), 'foreign file must survive');
});

test('partner: replacing a foreign file is 403', async () => {
  const form = new FormData();
  form.append('file', new Blob([png], { type: 'image/png' }), 'x.png');
  const { status } = await call('POST', `/api/files/${fileC}/replace`, { headers: AS_PARTNER, form });
  assert.strictEqual(status, 403);
});

test('partner: generating a cover from a foreign file is 403', async () => {
  const { status } = await call('POST', `/api/files/${fileC}/story`, { headers: AS_PARTNER, json: {} });
  assert.strictEqual(status, 403);
});

test('partner: move and copy are refused — they are owner-only', async () => {
  const m = await call('PATCH', `/api/files/${fileB}`, { headers: AS_PARTNER, json: { client_id: cA } });
  assert.strictEqual(m.status, 403);
  const c = await call('POST', `/api/files/${fileB}/copy`, { headers: AS_PARTNER, json: { client_id: cA } });
  assert.strictEqual(c.status, 403);
});

test('partner: deleting its own file works', async () => {
  const { status } = await call('DELETE', `/api/files/${fileA}`, { headers: AS_PARTNER });
  assert.strictEqual(status, 200);
  assert.ok(!db.prepare('SELECT 1 FROM files WHERE id = ?').get(fileA));
});

// ---------------------------------------------------------------------------
// The client list (the partner's sidebar)
// ---------------------------------------------------------------------------
test('partner: the client list is only its own vaults', async () => {
  const { status, body } = await call('GET', '/api/clients', { headers: AS_PARTNER });
  assert.strictEqual(status, 200);
  assert.deepStrictEqual(body.map(c => c.id).sort((x, y) => x - y), [cA, cB]);
});

test('partner: creating a client is refused', async () => {
  const { status } = await call('POST', '/api/clients', { headers: AS_PARTNER, json: { name: 'nope' } });
  assert.strictEqual(status, 403);
});

test('regression: a client key still cannot list clients', async () => {
  const { status } = await call('GET', '/api/clients', { headers: { 'X-API-Key': RAW_CLIENT } });
  assert.strictEqual(status, 403);
});

test('regression: an admin key still lists every client', async () => {
  const { status, body } = await call('GET', '/api/clients', { headers: { 'X-API-Key': RAW_ADMIN } });
  assert.strictEqual(status, 200);
  assert.strictEqual(body.length, 3);
});

test('regression: the owner session still lists every client', async () => {
  const { status, body } = await call('GET', '/api/clients', { headers: { 'x-test-session': '1' } });
  assert.strictEqual(status, 200);
  assert.strictEqual(body.length, 3);
});

// ---------------------------------------------------------------------------
// One lever, not two
// ---------------------------------------------------------------------------
test('revoking a key takes that vault out of the partner sight immediately', async () => {
  db.prepare("UPDATE api_keys SET revoked_at = datetime('now') WHERE id = ?").run(keyB);
  const files = await call('GET', '/api/files', { headers: AS_PARTNER });
  assert.ok(!files.body.some(f => f.client_id === cB), 'files from the revoked vault must be gone');
  const clients = await call('GET', '/api/clients', { headers: AS_PARTNER });
  assert.deepStrictEqual(clients.body.map(c => c.id), [cA]);
  db.prepare('UPDATE api_keys SET revoked_at = NULL WHERE id = ?').run(keyB);
});
