const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const config = require('../config');

const dbPath = path.join(config.MEDIA_DB_PATH, 'luna-visor.sqlite');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

// Migration: add referenced column
try {
  db.exec('ALTER TABLE files ADD COLUMN referenced INTEGER DEFAULT 0');
} catch {
  // Column already exists
}

// Migration: track which API key uploaded each file
try {
  db.exec('ALTER TABLE files ADD COLUMN api_key_id INTEGER REFERENCES api_keys(id)');
} catch {
  // Column already exists
}

// Migration: soft-delete for api_keys (preserves audit trail in files.api_key_id)
try {
  db.exec('ALTER TABLE api_keys ADD COLUMN revoked_at TEXT');
} catch {
  // Column already exists
}

// Migration: ephemeral clients (uploads auto-expire after 24h)
try {
  db.exec('ALTER TABLE clients ADD COLUMN is_ephemeral INTEGER DEFAULT 0');
} catch {
  // Column already exists
}

// Migration: extend files.type CHECK to allow 'lottie'.
// SQLite can't ALTER CHECK directly, and newer builds block PRAGMA writable_schema.
// Standard pattern: rebuild the table inside a transaction. Idempotent.
try {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='files'").get();
  if (row && row.sql && !row.sql.includes("'lottie'")) {
    db.pragma('foreign_keys = OFF');
    db.exec(`
      BEGIN TRANSACTION;
      CREATE TABLE files_new (
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
      INSERT INTO files_new (id, original_name, extension, mime_type, size_bytes, client_id, type, has_thumbnail, has_resized, created_at, updated_at, referenced, api_key_id)
        SELECT id, original_name, extension, mime_type, size_bytes, client_id, type, has_thumbnail, has_resized, created_at, updated_at, referenced, api_key_id FROM files;
      DROP TABLE files;
      ALTER TABLE files_new RENAME TO files;
      COMMIT;
    `);
    db.pragma('foreign_keys = ON');
    console.log('Migration applied: files.type CHECK now includes \'lottie\'');
  }
} catch (e) {
  console.error('Migration FAILED (files.type CHECK extension for lottie):', e.message);
}

module.exports = db;
