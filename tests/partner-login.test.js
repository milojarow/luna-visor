const path = require('path');
const fs = require('fs');

const SCRATCH_BASE = process.env.SCRATCHPAD
  || path.join(require('os').tmpdir(), 'luna-visor-tests');
const scratch = path.join(SCRATCH_BASE, 'luna-tests', 'partner-login');
fs.rmSync(scratch, { recursive: true, force: true });
fs.mkdirSync(path.join(scratch, 'db'), { recursive: true });
fs.mkdirSync(path.join(scratch, 'files'), { recursive: true });
process.env.MEDIA_PATH = scratch;
process.env.SESSION_SECRET = 'test';
process.env.ADMIN_PASSWORD_HASH = 'test';
process.env.CDN_BASE_URL = 'http://localhost';

const { test } = require('node:test');
const assert = require('node:assert');
const bcrypt = require('bcrypt');
const express = require('express');
const session = require('express-session');
const db = require('../src/db/connection');

db.prepare("INSERT INTO partners (name, display_name, password_hash) VALUES ('p1','P One', ?)")
  .run(bcrypt.hashSync('correct-horse', 10));
db.prepare("INSERT INTO partners (name, password_hash, disabled_at) VALUES ('off', ?, datetime('now'))")
  .run(bcrypt.hashSync('disabled-pass', 10));

const app = express();
app.use(express.json());
app.use(session({ secret: 'test', resave: false, saveUninitialized: false }));
app.use('/api/partner', require('../src/routes/partner'));
app.use('/api/auth', require('../src/routes/auth'));

async function call(method, pathname, body, cookie) {
  const server = app.listen(0);
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}${pathname}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return {
      status: res.status,
      cookie: res.headers.get('set-cookie'),
      body: await res.json().catch(() => null),
    };
  } finally {
    server.close();
  }
}

test('partner login: correct password authenticates', async () => {
  const { status, cookie } = await call('POST', '/api/partner/login', { password: 'correct-horse' });
  assert.strictEqual(status, 200);
  assert.ok(cookie, 'expected a session cookie');
});

test('partner login: wrong password is 401', async () => {
  const { status } = await call('POST', '/api/partner/login', { password: 'nope' });
  assert.strictEqual(status, 401);
});

test('partner login: missing password is 400', async () => {
  const { status } = await call('POST', '/api/partner/login', {});
  assert.strictEqual(status, 400);
});

test('partner login: a disabled partner cannot get in with its own password', async () => {
  const { status } = await call('POST', '/api/partner/login', { password: 'disabled-pass' });
  assert.strictEqual(status, 401);
});

test('partner login: the admin password is not a partner password', async () => {
  const { status } = await call('POST', '/api/partner/login', { password: 'test' });
  assert.strictEqual(status, 401);
});

test('status: reports role=partner once the cookie is held', async () => {
  const login = await call('POST', '/api/partner/login', { password: 'correct-horse' });
  const jar = login.cookie.split(';')[0];
  const { body } = await call('GET', '/api/auth/status', null, jar);
  assert.strictEqual(body.authenticated, true);
  assert.strictEqual(body.role, 'partner');
});

test('status: reports role=null with no session at all', async () => {
  const { body } = await call('GET', '/api/auth/status');
  assert.strictEqual(body.authenticated, false);
  assert.strictEqual(body.role, null);
});
