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

module.exports = db;
