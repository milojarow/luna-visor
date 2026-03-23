# Luna Visor

WUI for managing multimedia files served via CDN (`cdn.solutions45.com`).

## What it does

- Upload images and videos, organized by client
- Files stored with UUID names, original names visible only in the admin UI
- Images auto-resized to 3 variants (normal/big/bigger) via sharp
- Video thumbnails auto-generated via ffmpeg
- Custom right-click menu to copy CDN URLs
- Single-password session auth

## Stack

- **Backend**: Express + SQLite (better-sqlite3) + multer
- **Frontend**: Vanilla JS (no framework, no build step)
- **CDN**: Caddy serves `/srv/media/files/` at `cdn.solutions45.com`
- **WUI**: Caddy reverse proxies `luna.solutions45.com` → localhost:3000
- **Process**: systemd service (`luna-visor.service`)

## Setup

```bash
cp .env.example .env
# Edit .env with your values
npm install
node server.js
```

## File storage

All files live flat in `/srv/media/files/` named by UUID. Client organization is logical (SQLite), not physical directories.

```
/srv/media/
├── files/    # UUID-named files (served by Caddy)
└── db/       # SQLite database
```
