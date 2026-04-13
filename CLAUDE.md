# Luna Visor — Project Notes

CDN manager for solutions45.com. Serves files at `cdn.solutions45.com`, WUI at `luna.solutions45.com`.

## Stack

- Express 5 + better-sqlite3 (sync) + vanilla JS frontend (no build step)
- sharp for image processing (already installed — don't re-install)
- ffmpeg for video thumbnails (system binary at /usr/sbin/ffmpeg)
- Runs as systemd service `luna-visor.service` on port 3000 (NOT containerized)
- Node v25+ on selene

## File Structure

```
src/
  db/
    connection.js       — better-sqlite3, WAL, try/catch ALTER TABLE for migrations
    schema.sql          — CREATE TABLE IF NOT EXISTS for clients, files, api_keys
  middleware/
    auth.js             — requireAuth + requireSession. Checks X-API-Key before session.
  routes/
    auth.js             — login/logout/status
    clients.js          — CRUD clients (session only). Blocks delete if files or api_keys exist.
    files.js            — upload/list/get/patch/delete/copy/replace + cover generation routes
    api-keys.js         — CRUD api keys (session only)
    overlay.js          — POST /generate → transparent PNG for video-forge
  services/
    file-manager.js     — saveFile, deleteFile, moveFile, copyFile, replaceFile
    file-processor.js   — processImage (sharp variants), extractThumbnail (ffmpeg)
    cover-generator.js  — generateCover (JPEG with photo), generateOverlay (transparent PNG)
    branding.js         — Branding registry per client_id (logo, wordmark, colors, formats)
    log-scanner.js      — Marks files as "referenced" from Caddy logs
public/                 — vanilla JS WUI
server.js               — Express entry point
```

## Database

SQLite at `/srv/media/db/luna-visor.sqlite`:
- `clients` — id, name, slug, created_at
- `files` — id (UUID), original_name, extension, mime_type, size_bytes, client_id FK, type, has_thumbnail, has_resized, referenced, created_at, updated_at
- `api_keys` — id, name, key_hash (SHA-256), key_preview (last 4), client_id FK, created_at

Sessions at `/srv/media/db/sessions.sqlite` (express-session).

**No formal migrations**: `schema.sql` runs via `db.exec()` on startup with `CREATE TABLE IF NOT EXISTS`. New columns use try/catch `ALTER TABLE` in `connection.js`.

## File Storage

`/srv/media/files/` — flat directory, everything named by UUID:
- `{uuid}.{ext}` — original
- `{uuid}-normal.{ext}` / `{uuid}-big.{ext}` / `{uuid}-bigger.{ext}` — resized variants (images only)
- `{uuid}-thumb.jpg` — video thumbnails

**CDN URLs use UUIDs as public identifiers** — `https://cdn.solutions45.com/{uuid}.{ext}`. No original filenames exposed.

The filesystem is NOT the source of truth. The DB is. `mkdir` in `/srv/media/files/` does nothing — clients must be created via WUI or API.

## Authentication

Two methods checked in `src/middleware/auth.js`:

1. **Session auth**: bcrypt hash in `ADMIN_PASSWORD_HASH` env var, HttpOnly cookie, 7-day expiry. Full access.
2. **API key auth**: `X-API-Key` header. Keys are SHA-256 hashed (not bcrypt — high-entropy keys don't need salt). Each key tied to a `client_id`.

Middleware sets `req.authMethod = 'session' | 'api-key'` and `req.apiKeyClientId` when API key auth succeeds.

**`requireSession` guard** rejects `api-key` authMethod with 403. Applied per-route in files.js and at mount level in clients.js/api-keys.js.

API key scope: upload, replace, delete, and cover generation endpoints only — all with ownership check (file's `client_id` must match `req.apiKeyClientId`).

## Caddy Config

**Important**: Luna lives behind basic_auth in Caddy. API key requests must bypass basic_auth.

`/etc/caddy/conf.d/luna.solutions45.com`:
```
@api_key {
  header X-API-Key *
  path /api/files/upload /api/files/* /api/overlay/*
}
handle @api_key {
  reverse_proxy localhost:3000
}
handle {
  basic_auth { ... }
  reverse_proxy localhost:3000
}
```

When adding new API-key-accessible paths, update the `@api_key` matcher.

**CDN config** (`cdn.solutions45.com`): Plain file_server, public access, no user-agent restrictions. Anti-download protection was removed because video-forge outputs need to be consumable by external services like Upload Post.

## API Endpoints

### Auth (public for login/status)
- `POST /api/auth/login` — session login
- `GET /api/auth/status` — check session
- `POST /api/auth/logout`

### Clients (session only)
- `GET|POST /api/clients`
- `PATCH|DELETE /api/clients/:id` — delete blocked if files or api_keys exist

### Files
- `GET /api/files` — list (session)
- `GET /api/files/:id` — detail (session)
- `POST /api/files/upload` — multipart, field `files`, up to 20 × 500MB (session OR API key)
- `PATCH /api/files/:id` — move to another client (session)
- `DELETE /api/files/:id` — session OR API key (own files only)
- `POST /api/files/:id/copy` — session
- `POST /api/files/:id/replace` — multipart, field `file` (singular). Same UUID, same cdn_url. Session OR API key (own files)
- `POST /api/files/scan-references` — trigger log scan (session)

### Cover generation (session OR API key, own files only, format validated per client)
- `POST /api/files/:id/story` — 1080x1920 (Instagram story/reel)
- `POST /api/files/:id/cover` — 1080x1350 (Instagram feed post)
- `POST /api/files/:id/square` — 1080x1080 (Instagram square)
- `POST /api/files/:id/fb` — 1080x1080 (Facebook post)

Body:
```json
{
  "operation": "Casa en Venta",
  "location": "Reynosa, Tamaulipas",
  "bedrooms": "3",
  "bathrooms": "2½",
  "area": "140 m²",
  "amenities": { "parking": true, "garden": false, "trees": false }
}
```

Response (API key): `{ "cdn_url": "..." }`. Session: full file object.

### Overlay (session OR API key)
- `POST /api/overlay/generate` — transparent PNG, returns `image/png` directly (NOT saved to luna). Used by video-forge for FFmpeg compositing.
  - Body: same as cover generation + optional `width`/`height` (defaults 1080x1920)
  - `client_id` from API key, or from body for session auth

### API keys (session only)
- `GET /api/api-keys` — list with client names
- `POST /api/api-keys` — create, returns raw key ONCE
- `DELETE /api/api-keys/:id` — revoke

## Cover Generator Architecture

`src/services/cover-generator.js` has two main functions:

- **`generateCover`** — takes source photo + data, composites SVG overlay on top, outputs JPEG. Used by story/cover/square/fb routes. Saves result as new file in luna (same client_id as source).
- **`generateOverlay`** — takes only data, renders SVG on transparent canvas, outputs PNG buffer directly. Used by video-forge via `/api/overlay/generate`. Bigger typography than generateCover (uses `bigPill` instead of `pill`, doubled badge/logo/text/pills).

### Multi-client branding

`src/services/branding.js` is a registry keyed by `client_id`. Each entry has:
- `name`
- `logoIcon` — SVG string (placed top-right)
- `logoWordmark` — SVG string (placed next to icon)
- `watermarkIcon`, `watermarkText`, `watermarkFont` — for the diagonal watermark pattern
- `colors` — primary, dark, accent
- `formats` — array of supported format names (e.g., `['story', 'cover', 'square']`)

`getBranding(clientId)` returns the config or a generic fallback.

To add a new client with custom branding:
1. Add entry to `brands` object in `branding.js` keyed by their `client_id`
2. Add their supported formats to the `formats` array
3. No route changes needed — handlers auto-detect

**Posteacasa** (client_id 2): logo icon (copper house), wordmark in Georgia serif ("postea" dark + "casa" copper), formats: story/cover/square.

**Blindando Sueños** (client_id 1): no branding config yet — uses fallback. FB format reserved for them but not wired up.

### Format validation

`handleCoverGeneration` in `files.js` checks that the requested format is in the client's `formats` array before generating. Posteacasa calling `/fb` gets 400 "Format 'fb' not supported for this client".

### Fonts (system-level)

sharp uses librsvg to render SVG, which needs system fonts. If you see empty squares (□) where text should be, a font is missing.

Currently installed:
- `inter-font` (pacman) — Used for all `<text>` elements in covers (`'Inter', sans-serif`)
- `ttf-ms-fonts` (AUR via paru) — Used for posteacasa wordmark (`Georgia, serif`)

Before adding new font-family references in cover-generator.js or branding.js, verify the font is available: `fc-list | grep -i <fontname>`.

## Gotchas & Lessons

- **API key is server-to-server**: The website's backend uses it, never the browser. Each user's files are isolated in the app's own DB (postgres), not in luna. Luna only knows "this belongs to posteacasa" — per-user isolation is the app's responsibility.
- **Replace keeps the same UUID/cdn_url**: Use this for "undo" flows where the user swaps a photo without needing to update references in the app's DB.
- **Don't delete source files before testing cover generation**: The source image must exist on disk. When cleaning up test files, also clean the DB row.
- **Watermark covers only the safe zone**: 120px from top, 280px from bottom. Zones with text overlay are excluded so text stays readable.
- **Request body is `req.body`, not query params**: All cover/overlay endpoints take JSON body with the property data.
- **Caddy matches paths literally**: `/api/files/upload` and `/api/files/*` are both listed in the matcher because the matcher doesn't match prefixes implicitly. When adding new API-key routes, update Caddy.

## Backup

`src/services/cover-generator.backup.js` — pre-watermark version. Don't delete; serves as reference if the current generator needs to be rolled back.

## Testing Cover Generation

```bash
API_KEY="..."
FILE_ID="..."  # UUID of a posteacasa image
curl -s -X POST "https://luna.solutions45.com/api/files/$FILE_ID/story" \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"operation":"Casa en Venta","location":"Reynosa, Tamaulipas","bedrooms":"3","bathrooms":"2","area":"140 m²","amenities":{"parking":true,"garden":true,"trees":false}}'
```

For visual inspection, `cp /srv/media/files/{uuid}.jpg ~/pond/test.jpg` and open with Read tool.

## Restart

```bash
sudo systemctl restart luna-visor
sudo systemctl reload caddy    # only if Caddy config changed
```

Logs: `journalctl -u luna-visor -f`
