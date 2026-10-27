const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { test, after } = require('node:test');
const assert = require('node:assert/strict');

// Every byte (including multer temporaries) is isolated from production media.
const scratch = fs.mkdtempSync(path.join(process.env.SCRATCHPAD || os.tmpdir(), 'api-contract-'));
process.env.MEDIA_PATH = scratch;
process.env.TMPDIR = scratch;
process.env.SESSION_SECRET = 'test';
process.env.ADMIN_PASSWORD_HASH = 'test';
process.env.CDN_BASE_URL = 'https://cdn.test';
for (const dir of ['db', 'files']) fs.mkdirSync(path.join(scratch, dir));
const express = require('express');
const sharp = require('sharp');
const db = require('../src/db/connection');
const branding = require('../src/services/branding');
// Synthetic branding only in this test process, never alter local branding.config.js.
const brands = {};
branding.getBranding = id => brands[id] || { formats: [], layout: 'default' };
branding.getImagePolicy = () => branding.DEFAULT_IMAGE_POLICY;
const { requireAuth } = require('../src/middleware/auth');
const { replaceFile } = require('../src/services/file-manager');
const { expireOldFiles } = require('../src/services/file-expirer');
const spec = require('../src/openapi');
const keys = {};
const ids = {};
for (const [name, raw, ephemeral] of [['normal', 0, 0], ['raw', 1, 0], ['ephemeral', 0, 1], ['both', 1, 1], ['disabled', 0, 0]]) {
  const id = Number(db.prepare('INSERT INTO clients (name, slug, preserve_format, is_ephemeral) VALUES (?, ?, ?, ?)').run(name, name, raw, ephemeral).lastInsertRowid);
  ids[name] = id;
  keys[name] = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO api_keys (name, key_hash, key_preview, client_id) VALUES (?, ?, ?, ?)').run(name, crypto.createHash('sha256').update(keys[name]).digest('hex'), 'test', id);
  brands[id] = { layout: 'minimal', formats: name === 'disabled' ? [] : ['story', 'watermark'], watermarkText: 'TEST', watermark: { logoOpacity: 0 } };
}
keys.admin = crypto.randomBytes(32).toString('hex');
db.prepare("INSERT INTO api_keys (name, key_hash, key_preview, is_admin) VALUES ('admin', ?, 'test', 1)").run(crypto.createHash('sha256').update(keys.admin).digest('hex'));
const app = express();
app.use(express.json());
app.use('/api/openapi.json', (_req, res) => res.json(spec));
app.use(requireAuth);
const routers = {};
for (const name of ['me', 'files', 'clients', 'api-keys', 'overlay']) {
  routers[name] = require(`../src/routes/${name}`);
  app.use(`/api/${name}`, routers[name]);
}
app.use(require('../src/middleware/error'));
const server = app.listen(0, '127.0.0.1');
const ready = new Promise(resolve => server.on('listening', resolve));
after(async () => { await new Promise(resolve => server.close(resolve)); db.close(); });
async function api(name, route, options = {}) {
  await ready;
  const headers = { 'X-API-Key': keys[name], ...options.headers };
  const res = await fetch(`http://127.0.0.1:${server.address().port}/api${route}`, { ...options, headers });
  return { status: res.status, body: await res.json() };
}
async function image(format = 'png') {
  return sharp({ create: { width: 320, height: 240, channels: 3, background: '#b06030' } })[format]().toBuffer();
}
async function upload(name, entries) {
  const body = new FormData();
  for (const [filename, bytes] of entries) body.append('files', new Blob([bytes]), filename);
  return api(name, '/files/upload', { method: 'POST', body });
}
async function replace(name, id, filename, bytes) {
  const body = new FormData();
  body.append('file', new Blob([bytes]), filename);
  return api(name, `/files/${id}/replace`, { method: 'POST', body });
}
const idOf = url => path.basename(new URL(url).pathname).split('.')[0];
const disk = url => path.join(scratch, 'files', path.basename(new URL(url).pathname));

// Pin discovery against real registered handlers, not a second handwritten route list.
test('all registered API routes and every /me callable endpoint exist in OpenAPI', async () => {
  for (const [base, router] of Object.entries(routers)) {
    for (const layer of router.stack.filter(l => l.route)) {
      const route = (`/${base}` + (layer.route.path === '/' ? '' : layer.route.path)).replace(/:([a-z_]+)/g, '{$1}');
      for (const method of Object.keys(layer.route.methods)) assert.ok(spec.paths[route]?.[method], `${method} ${route} missing from OpenAPI`);
    }
  }
  for (const name of Object.keys(keys)) {
    const { status, body } = await api(name, '/me');
    assert.equal(status, 200);
    const schema = spec.components.schemas[name === 'admin' ? 'AdminMeResponse' : 'MeResponse'];
    for (const field of schema.required) assert.ok(field in body, `${name}: missing ${field}`);
    for (const endpoint of body.callable_endpoints) {
      const [method, route] = endpoint.split(' ');
      assert.ok(spec.paths[route.replace(/^\/api/, '')]?.[method.toLowerCase()], endpoint);
    }
    if (name === 'admin') {
      assert.equal(body.client, undefined);
      assert.equal(body.api_key.is_admin, true);
      assert.ok(body.callable_endpoints.includes('GET /api/files'));
      assert.ok(!body.callable_endpoints.includes('POST /api/files/{id}/watermark'));
    } else {
      const enabled = name !== 'disabled';
      assert.equal(body.callable_endpoints.includes('POST /api/files/{id}/watermark'), enabled);
      assert.equal(Boolean(body.branding.watermark_body_example), enabled);
      const allowed = spec.components.schemas.MeResponse.properties.branding.properties.available_cover_formats.items.enum;
      for (const format of body.branding.available_cover_formats) assert.ok(allowed.includes(format));
      assert.equal(body.client.is_ephemeral, ['both', 'ephemeral'].includes(name));
      assert.equal(body.client.preserve_format, ['both', 'raw'].includes(name));
    }
  }
});

test('upload partial and all-item failure remain 201 arrays; GET includes id; admin reads but cannot write', async () => {
  const mixed = await upload('normal', [['good.png', await image()], ['bad.pdf', Buffer.from('%PDF-1.7')]]);
  assert.equal(mixed.status, 201);
  assert.equal(mixed.body.length, 2);
  assert.deepEqual(Object.keys(mixed.body[0]), ['cdn_url']);
  assert.deepEqual(Object.keys(mixed.body[1]), ['error']);
  const failed = await upload('raw', [['bad.pdf', Buffer.from('%PDF-1.7')], ['fake.png', Buffer.from('not an image')]]);
  assert.equal(failed.status, 201);
  assert.ok(failed.body.every(item => item.error));
  const listed = await api('normal', '/files');
  assert.equal(listed.status, 200);
  assert.equal(listed.body[0].id, idOf(mixed.body[0].cdn_url));
  const admin = await api('admin', `/files/${listed.body[0].id}`);
  assert.equal(admin.status, 200);
  assert.equal(admin.body.client_name, 'normal');
  assert.equal((await api('admin', '/files')).status, 200);
  assert.equal((await api('admin', '/files/upload', { method: 'POST' })).status, 403);
  assert.equal((await api('admin', `/files/${admin.body.id}/replace`, { method: 'POST' })).status, 403);
});

for (const name of ['normal', 'raw', 'ephemeral', 'both']) {
  test(`${name}: replacement preserves UUID/date/attribution, changes extension when appropriate, no TTL renewal`, async () => {
    const png = await image();
    const jpg = await image('jpeg');
    const first = await upload(name, [['before.png', png]]);
    assert.equal(first.status, 201);
    const url = first.body[0].cdn_url;
    const id = idOf(url);
    assert.equal(path.extname(url), name === 'normal' ? '.webp' : '.png');
    if (name !== 'normal') {
      assert.deepEqual(fs.readFileSync(disk(url)), png, 'raw/ephemeral upload preserves original bytes');
      assert.deepEqual(fs.readdirSync(path.join(scratch, 'files')).filter(f => f.startsWith(id)), [`${id}.png`]);
    }
    db.prepare("UPDATE files SET created_at = datetime('now', '-48 hours') WHERE id = ?").run(id);
    const before = db.prepare('SELECT * FROM files WHERE id = ?').get(id);
    const result = await replace(name, id, 'after.jpg', jpg);
    assert.equal(result.status, 200);
    assert.deepEqual(Object.keys(result.body), ['cdn_url']);
    assert.equal(idOf(result.body.cdn_url), id);
    const row = db.prepare('SELECT * FROM files WHERE id = ?').get(id);
    assert.equal(row.created_at, before.created_at);
    assert.equal(row.api_key_id, before.api_key_id);
    assert.equal(row.extension, name === 'normal' ? 'webp' : 'jpg');
    if (name === 'normal') {
      assert.equal(result.body.cdn_url, url);
      assert.ok(fs.existsSync(path.join(scratch, 'files', `${id}-thumb.webp`)));
    } else {
      assert.notEqual(result.body.cdn_url, url);
      assert.ok(!fs.existsSync(disk(url)));
      assert.deepEqual(fs.readFileSync(disk(result.body.cdn_url)), jpg);
      assert.deepEqual(fs.readdirSync(path.join(scratch, 'files')).filter(f => f.startsWith(id)), [`${id}.jpg`]);
    }
    const rejected = await replace(name, id, 'invalid.pdf', Buffer.from('%PDF'));
    assert.equal(rejected.status, 400);
    assert.ok(fs.existsSync(disk(result.body.cdn_url)));
    expireOldFiles();
    assert.equal(Boolean(db.prepare('SELECT id FROM files WHERE id = ?').get(id)), !['ephemeral', 'both'].includes(name));
  });
}

test('legacy normal extension changes on replace; failed processing preserves original and cleans temporary variants', async () => {
  const id = crypto.randomUUID();
  const jpg = await image('jpeg');
  fs.writeFileSync(path.join(scratch, 'files', `${id}.jpg`), jpg);
  db.prepare("INSERT INTO files (id, original_name, extension, mime_type, size_bytes, client_id, type) VALUES (?, 'legacy', 'jpg', 'image/jpeg', ?, ?, 'image')").run(id, jpg.length, ids.normal);
  const result = await replace('normal', id, 'new.png', await image());
  assert.equal(result.status, 200);
  assert.equal(result.body.cdn_url, `https://cdn.test/${id}.webp`);
  assert.ok(!fs.existsSync(path.join(scratch, 'files', `${id}.jpg`)));
  const before = fs.readdirSync(path.join(scratch, 'files')).sort();
  const bytes = fs.readFileSync(disk(result.body.cdn_url));
  const tmp = path.join(scratch, 'corrupt.png');
  fs.writeFileSync(tmp, 'bad sharp input');
  await assert.rejects(replaceFile(id, tmp, 'bad.png', 'image/png', 15));
  assert.deepEqual(fs.readdirSync(path.join(scratch, 'files')).sort(), before);
  assert.deepEqual(fs.readFileSync(disk(result.body.cdn_url)), bytes);
  assert.ok(!fs.existsSync(tmp));
});

test('watermark uses enabled branding, returns NEW UUID, keeps source bytes/dimensions, rejects foreign/admin/non-image/disabled/missing', async () => {
  const first = await upload('raw', [['master.png', await image()]]);
  const url = first.body[0].cdn_url;
  const id = idOf(url);
  const source = fs.readFileSync(disk(url));
  const result = await api('raw', `/files/${id}/watermark`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'TEST', logo_opacity: 0, pattern_opacity: 0.3 }) });
  assert.equal(result.status, 201);
  assert.deepEqual(Object.keys(result.body), ['cdn_url']);
  assert.notEqual(idOf(result.body.cdn_url), id);
  assert.deepEqual(fs.readFileSync(disk(url)), source);
  const meta = await sharp(disk(result.body.cdn_url)).metadata();
  assert.equal(meta.width, 320);
  assert.equal(meta.height, 240);
  assert.equal(meta.format, 'webp');
  assert.equal(db.prepare('SELECT client_id FROM files WHERE id = ?').get(idOf(result.body.cdn_url)).client_id, ids.raw);
  assert.equal((await api('normal', `/files/${id}/watermark`, { method: 'POST' })).status, 403);
  assert.equal((await api('admin', `/files/${id}/watermark`, { method: 'POST' })).status, 403);
  assert.equal((await api('raw', `/files/${crypto.randomUUID()}/watermark`, { method: 'POST' })).status, 404);
  const disabled = await upload('disabled', [['source.png', await image()]]);
  assert.equal((await api('disabled', `/files/${idOf(disabled.body[0].cdn_url)}/watermark`, { method: 'POST' })).status, 400);
  const vector = await upload('raw', [['vector.svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>')]]);
  assert.equal((await api('raw', `/files/${idOf(vector.body[0].cdn_url)}/watermark`, { method: 'POST' })).status, 400);
  const defaults = await api('raw', `/files/${id}/watermark`, { method: 'POST' });
  assert.equal(defaults.status, 201, 'body is optional');
});

test('contract response unions allow overlapping File/FileMinimal schemas and use correct multipart fields', () => {
  assert.ok(spec.components.schemas.UploadItemResult.anyOf);
  assert.ok(spec.paths['/files/{id}'].get.responses[200].content['application/json'].schema.anyOf);
  const uploadSchema = spec.paths['/files/upload'].post.requestBody.content['multipart/form-data'].schema;
  const replaceSchema = spec.paths['/files/{id}/replace'].post.requestBody.content['multipart/form-data'].schema;
  assert.deepEqual(uploadSchema.required, ['files']);
  assert.equal(uploadSchema.properties.files.type, 'array');
  assert.deepEqual(replaceSchema.required, ['file']);
  assert.equal(replaceSchema.properties.file.format, 'binary');
  const wm = spec.paths['/files/{id}/watermark'].post;
  assert.equal(wm.requestBody.required, false);
  for (const status of [201, 400, 401, 403, 404, 429, 500]) assert.ok(wm.responses[status]);
  assert.equal(fs.readdirSync(path.join(scratch, 'luna-visor-uploads')).length, 0, 'no residual upload temporaries');
});

test('vault flags remain create-time only when PATCH renames a vault', async () => {
  const result = await api('admin', `/clients/${ids.raw}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'raw-renamed', preserve_format: false, is_ephemeral: true }),
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.preserve_format, 1);
  assert.equal(result.body.is_ephemeral, 0);
});

test('watermark rejects invalid authentication and enforces shared cover rate limit', async () => {
  const id = crypto.randomUUID();
  const invalid = await api('raw', `/files/${id}/watermark`, { method: 'POST', headers: { 'X-API-Key': 'invalid-test-key' } });
  assert.equal(invalid.status, 401);
  // Missing sources exercise the real limiter without generating more media.
  let result;
  for (let i = 0; i < 30; i++) result = await api('disabled', `/files/${id}/watermark`, { method: 'POST' });
  assert.equal(result.status, 429);
  assert.equal((await api('disabled', `/files/${id}/story`, { method: 'POST' })).status, 429, 'same limiter as covers');
});
