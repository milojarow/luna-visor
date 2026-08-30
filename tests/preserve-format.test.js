const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const SCRATCH_BASE = process.env.SCRATCHPAD
  || path.join(require('os').tmpdir(), 'luna-visor-tests');
const scratch = path.join(SCRATCH_BASE, 'luna-tests', 'preserve-format');
fs.rmSync(scratch, { recursive: true, force: true });
fs.mkdirSync(path.join(scratch, 'db'), { recursive: true });
fs.mkdirSync(path.join(scratch, 'files'), { recursive: true });
process.env.MEDIA_PATH = scratch;
process.env.SESSION_SECRET = 'test';
process.env.ADMIN_PASSWORD_HASH = 'test';
process.env.CDN_BASE_URL = 'http://localhost';

const { test, after } = require('node:test');
const assert = require('node:assert');
const express = require('express');
const sharp = require('sharp');
const db = require('../src/db/connection');
const { saveFile } = require('../src/services/file-manager');
const { expireOldFiles } = require('../src/services/file-expirer');
const { requireAuth } = require('../src/middleware/auth');

const FILES_DIR = path.join(scratch, 'files');
const sha = buf => crypto.createHash('sha256').update(buf).digest('hex');

// --- seed ---------------------------------------------------------------
const RAW_ADMIN = 'raw-admin-key-preserve-format';
db.prepare("INSERT INTO api_keys (name, key_hash, key_preview, client_id, is_admin) VALUES ('adm', ?, 'aaaa', NULL, 1)")
  .run(sha(RAW_ADMIN));

const rawClientId = db.prepare("INSERT INTO clients (name, slug, preserve_format) VALUES ('raw', 'raw', 1)")
  .run().lastInsertRowid;
const normalClientId = db.prepare("INSERT INTO clients (name, slug) VALUES ('normal', 'normal')")
  .run().lastInsertRowid;

// --- minimal app, same wiring order as server.js -------------------------
const app = express();
app.use(express.json());
app.use(requireAuth);
app.use('/api/clients', require('../src/routes/clients'));
app.use(require('../src/middleware/error'));
const server = app.listen(0);
const port = server.address().port;
after(() => server.close());

async function api(method, p, body) {
  const res = await fetch(`http://127.0.0.1:${port}${p}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-API-Key': RAW_ADMIN },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
}

// A real PNG, so sharp has something genuine to either re-encode or leave alone.
async function makePng(name) {
  const src = path.join(scratch, name);
  await sharp({ create: { width: 16, height: 16, channels: 3, background: { r: 200, g: 30, b: 30 } } })
    .png().toFile(src);
  return src;
}

function variantsOf(fileId) {
  return fs.readdirSync(FILES_DIR).filter(f => f.startsWith(fileId)).sort();
}

// --- schema --------------------------------------------------------------

test('clients.preserve_format exists and defaults to 0', () => {
  const col = db.prepare('PRAGMA table_info(clients)').all().find(c => c.name === 'preserve_format');
  assert.ok(col, 'column exists');
  db.prepare("INSERT INTO clients (name, slug) VALUES ('defaults', 'defaults')").run();
  const row = db.prepare("SELECT preserve_format FROM clients WHERE slug = 'defaults'").get();
  assert.strictEqual(row.preserve_format, 0);
});

// --- route ---------------------------------------------------------------

test('admin key can create a permanent preserve_format vault', async () => {
  const { status, body } = await api('POST', '/api/clients', { name: 'vault-raw', preserve_format: true });
  assert.strictEqual(status, 201);
  assert.strictEqual(body.preserve_format, 1);
  assert.strictEqual(body.is_ephemeral, 0, 'permanent: the 24h TTL flag stays off');
});

test('the two flags are independent and can be combined', async () => {
  const { status, body } = await api('POST', '/api/clients', {
    name: 'vault-both', preserve_format: true, is_ephemeral: true,
  });
  assert.strictEqual(status, 201);
  assert.strictEqual(body.preserve_format, 1);
  assert.strictEqual(body.is_ephemeral, 1);
});

test('POST /api/clients without the flag leaves normalization on', async () => {
  const { status, body } = await api('POST', '/api/clients', { name: 'vault-plain' });
  assert.strictEqual(status, 201);
  assert.strictEqual(body.preserve_format, 0);
});

// --- upload pipeline -----------------------------------------------------

test('upload to a preserve_format client keeps the bytes and the extension', async () => {
  const src = await makePng('raw-src.png');
  const original = fs.readFileSync(src);
  const tmp = path.join(scratch, 'raw-upload.png');
  fs.copyFileSync(src, tmp); // saveFile unlinks its temp path

  const row = await saveFile(tmp, 'foto.png', 'image/png', original.length, rawClientId);

  assert.strictEqual(row.extension, 'png', 'no webp conversion');
  assert.strictEqual(row.has_resized, 0);
  assert.strictEqual(row.has_thumbnail, 0);
  assert.strictEqual(row.size_bytes, original.length);
  assert.deepStrictEqual(variantsOf(row.id), [`${row.id}.png`], 'no -thumb / -md variants');
  assert.strictEqual(
    sha(fs.readFileSync(path.join(FILES_DIR, `${row.id}.png`))),
    sha(original),
    'stored file is byte-for-byte identical to the upload',
  );
});

test('the same upload to a normal client is still re-encoded to webp', async () => {
  const src = await makePng('normal-src.png');
  const original = fs.readFileSync(src);
  const tmp = path.join(scratch, 'normal-upload.png');
  fs.copyFileSync(src, tmp);

  const row = await saveFile(tmp, 'foto.png', 'image/png', original.length, normalClientId);

  assert.strictEqual(row.extension, 'webp', 'control: default pipeline untouched');
  assert.strictEqual(row.has_resized, 1);
  assert.deepStrictEqual(variantsOf(row.id), [`${row.id}-thumb.webp`, `${row.id}.webp`]);
});

// --- permanence ----------------------------------------------------------

test('the 24h expirer never sweeps a preserve_format vault', () => {
  const before = db.prepare('SELECT COUNT(*) AS n FROM files WHERE client_id = ?').get(rawClientId).n;
  assert.ok(before > 0, 'there is something to sweep');

  db.prepare("UPDATE files SET created_at = datetime('now', '-48 hours') WHERE client_id = ?").run(rawClientId);
  const deleted = expireOldFiles();

  assert.strictEqual(deleted, 0, 'expirer keys off is_ephemeral only');
  assert.strictEqual(
    db.prepare('SELECT COUNT(*) AS n FROM files WHERE client_id = ?').get(rawClientId).n,
    before,
    'files two days old are still there',
  );
});
