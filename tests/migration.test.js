const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const Database = require('better-sqlite3');

const ROOT = path.join(__dirname, '..');
const SCRATCH_BASE = process.env.SCRATCHPAD
  || '/tmp/claude-1001/-home-endymion/690fc0c6-9674-486e-971d-2e5e1fdc07a5/scratchpad';

function freshScratch(name) {
  const dir = path.join(SCRATCH_BASE, 'luna-tests', name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, 'db'), { recursive: true });
  return dir;
}

function runConnection(mediaPath) {
  execFileSync(process.execPath, ['-e', `require(${JSON.stringify(path.join(ROOT, 'src/db/connection.js'))})`], {
    env: {
      ...process.env,
      MEDIA_PATH: mediaPath,
      SESSION_SECRET: 'test',
      ADMIN_PASSWORD_HASH: 'test',
      CDN_BASE_URL: 'http://localhost',
    },
  });
}

function openDb(mediaPath) {
  return new Database(path.join(mediaPath, 'db', 'luna-visor.sqlite'));
}

// Pre-migration production shape of api_keys (client_id NOT NULL, no is_admin)
// plus minimal clients/files so FK survival can be asserted.
const OLD_SHAPE = `
CREATE TABLE clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    slug TEXT NOT NULL UNIQUE,
    created_at TEXT DEFAULT (datetime('now')),
    is_ephemeral INTEGER DEFAULT 0
);
CREATE TABLE api_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    key_hash TEXT NOT NULL UNIQUE,
    key_preview TEXT NOT NULL,
    client_id INTEGER NOT NULL REFERENCES clients(id),
    created_at TEXT DEFAULT (datetime('now')),
    revoked_at TEXT
);
CREATE TABLE files (
    id TEXT PRIMARY KEY,
    original_name TEXT NOT NULL,
    extension TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    client_id INTEGER NOT NULL REFERENCES clients(id),
    type TEXT NOT NULL CHECK(type IN ('image', 'video', 'audio', 'vector', 'lottie')),
    has_thumbnail INTEGER DEFAULT 0,
    has_resized INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    referenced INTEGER DEFAULT 0,
    api_key_id INTEGER REFERENCES api_keys(id)
);
INSERT INTO clients (id, name, slug) VALUES (1, 'posteacasa', 'posteacasa');
INSERT INTO api_keys (id, name, key_hash, key_preview, client_id, revoked_at)
  VALUES (1, 'live key', 'hash-aaa', 'aaaa', 1, NULL),
         (2, 'old key', 'hash-bbb', 'bbbb', 1, '2026-05-01 00:00:00');
INSERT INTO files (id, original_name, extension, mime_type, size_bytes, client_id, type, api_key_id)
  VALUES ('uuid-1', 'foto', 'webp', 'image/webp', 100, 1, 'image', 1);
`;

function assertNewShape(db) {
  const cols = db.prepare('PRAGMA table_info(api_keys)').all();
  const byName = Object.fromEntries(cols.map(c => [c.name, c]));
  assert.ok(byName.is_admin, 'is_admin column exists');
  assert.strictEqual(byName.client_id.notnull, 0, 'client_id is nullable');
  // CHECK invariant: admin with client_id must fail
  assert.throws(() => db.prepare(
    "INSERT INTO api_keys (name, key_hash, key_preview, client_id, is_admin) VALUES ('bad', 'h1', 'xxxx', 1, 1)"
  ).run(), /CHECK/);
  // CHECK invariant: client key without client_id must fail
  assert.throws(() => db.prepare(
    "INSERT INTO api_keys (name, key_hash, key_preview, client_id, is_admin) VALUES ('bad2', 'h2', 'xxxx', NULL, 0)"
  ).run(), /CHECK/);
  // admin key inserts fine
  db.prepare("INSERT INTO api_keys (name, key_hash, key_preview, client_id, is_admin) VALUES ('adm', 'h3', 'xxxx', NULL, 1)").run();
  db.prepare("DELETE FROM api_keys WHERE key_hash IN ('h3')").run();
}

test('fresh DB gets new-shape api_keys from schema.sql', () => {
  const scratch = freshScratch('fresh');
  runConnection(scratch);
  const db = openDb(scratch);
  assertNewShape(db);
  db.close();
});

test('old-shape DB is rebuilt preserving rows and FKs', () => {
  const scratch = freshScratch('legacy');
  const dbPath = path.join(scratch, 'db', 'luna-visor.sqlite');
  const seed = new Database(dbPath);
  seed.exec(OLD_SHAPE);
  seed.close();

  runConnection(scratch);

  const db = openDb(scratch);
  assertNewShape(db);
  const rows = db.prepare('SELECT * FROM api_keys ORDER BY id').all();
  assert.strictEqual(rows.length, 2, 'both rows preserved');
  assert.deepStrictEqual(
    rows.map(r => [r.id, r.name, r.key_hash, r.key_preview, r.client_id, r.is_admin, r.revoked_at]),
    [
      [1, 'live key', 'hash-aaa', 'aaaa', 1, 0, null],
      [2, 'old key', 'hash-bbb', 'bbbb', 1, 0, '2026-05-01 00:00:00'],
    ],
  );
  assert.strictEqual(db.prepare('SELECT api_key_id FROM files WHERE id = ?').get('uuid-1').api_key_id, 1);
  assert.deepStrictEqual(db.prepare('PRAGMA foreign_key_check').all(), [], 'no FK violations');
  // id sequence survives the rebuild: ids 1-2 preserved, assertNewShape's probe
  // insert consumed 3 (AUTOINCREMENT never reuses), so the next insert gets 4.
  const r = db.prepare("INSERT INTO api_keys (name, key_hash, key_preview, client_id, is_admin) VALUES ('next', 'h9', 'xxxx', NULL, 1)").run();
  assert.strictEqual(r.lastInsertRowid, 4);
  db.close();
});

test('migration is idempotent', () => {
  const scratch = freshScratch('idempotent');
  const dbPath = path.join(scratch, 'db', 'luna-visor.sqlite');
  const seed = new Database(dbPath);
  seed.exec(OLD_SHAPE);
  seed.close();

  runConnection(scratch);
  runConnection(scratch); // second run must be a no-op

  const db = openDb(scratch);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS n FROM api_keys').get().n, 2);
  db.close();
});
