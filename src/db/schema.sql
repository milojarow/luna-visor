CREATE TABLE IF NOT EXISTS clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    slug TEXT NOT NULL UNIQUE,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS files (
    id TEXT PRIMARY KEY,
    original_name TEXT NOT NULL,
    extension TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    client_id INTEGER NOT NULL REFERENCES clients(id),
    api_key_id INTEGER REFERENCES api_keys(id),
    type TEXT NOT NULL CHECK(type IN ('image', 'video', 'audio', 'vector', 'lottie')),
    has_thumbnail INTEGER DEFAULT 0,
    has_resized INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS api_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    key_hash TEXT NOT NULL UNIQUE,
    key_preview TEXT NOT NULL,
    client_id INTEGER REFERENCES clients(id),
    is_admin INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    revoked_at TEXT,
    CHECK ((is_admin = 1 AND client_id IS NULL) OR (is_admin = 0 AND client_id IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS partners (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    display_name TEXT,
    password_hash TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    disabled_at TEXT
);
