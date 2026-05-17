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

module.exports = db;
