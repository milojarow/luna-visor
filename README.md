# Luna Visor

Self-hosted CDN manager with a web UI. Upload and organize media files (images, videos), serve them at public URLs by UUID, and optionally generate branded cover images for social media.

Built for people who want to host their own CDN backing store without Cloudflare R2 / AWS S3 / Bunny bills, and without deploying a database-heavy app.

## Features

- **Upload and organize media** by client (logical namespaces, not directories). Drag-and-drop or paste from clipboard in the web UI, or `POST` multipart from your own apps with API keys.
- **Served by UUID** — URLs like `https://cdn.example.com/{uuid}.webp`. Original filenames never leak. A preview variant is auto-generated for gallery thumbnails.
- **Standard re-encoding on ingest**: every uploaded image lands as WebP and every video as MP4 (H.264/AAC), regardless of input format. Per-client `storagePolicy` overrides let you tune variants and quality for specific tenants.
- **Ephemeral clients** (opt-in). A separate flavor of client where every upload auto-expires 24 hours after creation and is stored as-is (no re-encoding, no thumbnail variants). Created from a drop-up menu next to "+ New Client". The gallery shows a per-file "expires in Xh Ym" badge and a calendar-clock icon next to the client name everywhere it appears.
- **Cover generator** (opt-in). Composite your brand (logo, wordmark, colors, watermark) over uploaded photos at Instagram Story / Post / Square dimensions. Optional overlay endpoint returns transparent PNGs for video compositing.
- **Two auth methods**: session (single admin password) for the web UI; API keys scoped to a single client for server-to-server uploads from your own apps.
- **Log scanner** (optional). Tails your reverse proxy's JSON access log and marks files as "referenced" when hit by external referers, so you can spot orphans.

## Stack

- Node.js + Express 5 — no build step, no TypeScript
- SQLite via `better-sqlite3` (synchronous, WAL mode)
- `sharp` for image processing, `ffmpeg` for video thumbnails
- Vanilla JS frontend (no framework, no bundler)
- Bring-your-own reverse proxy with HTTPS (Caddy, nginx, etc.)

## Prerequisites

- Node.js ≥ 18
- System packages for `sharp` (usually handled by the prebuilt binary; if you need to compile, install libvips dev headers)
- `ffmpeg` on `PATH` (only needed if you upload videos and want auto thumbnails)
- A reverse proxy in front of the app that terminates TLS and serves the media directory as a plain file server
- Optional, for the cover generator: a system font matching the `font-family` referenced in your brand configs. Default config uses `Inter` — install e.g. `inter-font` on Arch, or drop TTFs under `~/.fonts/` on any Linux, then `fc-cache -f`. Missing fonts render as empty squares.

## Setup

```bash
git clone <this-repo> luna-visor
cd luna-visor
npm install

# Create a media root that the app user can write to
sudo mkdir -p /srv/media/files /srv/media/db
sudo chown -R $USER:$USER /srv/media

# Generate secrets and set up .env
cp .env.example .env
node -e "console.log('SESSION_SECRET=' + require('crypto').randomBytes(64).toString('hex'))" >> .env
node -e "console.log('ADMIN_PASSWORD_HASH=' + require('bcrypt').hashSync(process.argv[1], 12))" 'your-password-here' >> .env
# Edit .env and fill in CDN_BASE_URL (and LUNA_BASE_URL if applicable)

# Start
node server.js
```

The SQLite schema is created automatically on first run.

The app binds to `127.0.0.1:3000` by default (controlled by `PORT`). It expects a reverse proxy in front — don't expose it directly.

## Reverse proxy

Two virtual hosts are needed:

1. **`cdn.example.com`** — a plain file server pointed at `/srv/media/files/`. Public access, no auth. This is where `cdn_url` responses resolve to.
2. **`luna.example.com`** — a reverse proxy to `127.0.0.1:3000` with basic auth *except* for paths that accept `X-API-Key` (upload, overlay, and per-file endpoints), so your external apps can hit those without a browser prompt.

Caddy example:

```caddy
cdn.example.com {
  root * /srv/media/files
  file_server
}

luna.example.com {
  @api_key {
    header X-API-Key *
    path /api/files/upload /api/files/* /api/overlay/*
  }
  handle @api_key {
    reverse_proxy 127.0.0.1:3000
  }
  handle {
    basic_auth {
      admin $2a$14$your-bcrypt-hash-here
    }
    reverse_proxy 127.0.0.1:3000
  }
}
```

If you add new API-key-accessible routes to the app, update the `@api_key` matcher accordingly.

## Running as a systemd service

```ini
# /etc/systemd/system/luna-visor.service
[Unit]
Description=Luna Visor — Media CDN Manager
After=network.target

[Service]
Type=simple
User=your-app-user
WorkingDirectory=/path/to/luna-visor
ExecStart=/usr/bin/node server.js
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now luna-visor
journalctl -u luna-visor -f
```

## API

All routes are under `/api`. Full details in [`src/routes/`](src/routes/).

**Auth**
- `POST /api/auth/login` — body `{ password }`, sets session cookie
- `GET /api/auth/status` — returns `{ authenticated, cdn_base_url }`
- `POST /api/auth/logout`

**Clients** (session only)
- `GET /api/clients` — each row includes `is_ephemeral` (0 or 1)
- `POST /api/clients` — body `{ name, is_ephemeral?: boolean }`. Default `false`
- `PATCH | DELETE /api/clients/:id` (delete blocked if client has files or active api keys)

**Files**
- `GET /api/files` — list (session) — optional `?client_id=`. Each file row includes `api_key_id`, `api_key_name`, `api_key_revoked_at`, and `client_is_ephemeral` (LEFT JOINed). The last lets the gallery render countdown badges. `NULL` for files uploaded before per-file API-key tracking was added.
- `POST /api/files/upload` — multipart, field `files`, up to 20 × 500MB — session or API key. New files record the API key ID used to upload them.
- `PATCH /api/files/:id` — move to another client (session)
- `POST /api/files/:id/copy` — copy to another client (session)
- `POST /api/files/:id/replace` — multipart, field `file` — same UUID, same cdn_url — session or API key (own client only). Replace keeps the original `api_key_id` (the "first source" of the file).
- `DELETE /api/files/:id` — session or API key (own client only)
- `POST /api/files/scan-references` — trigger log scan (session)

**Cover generation** (session or API key, own client only, format validated per client's brand config)
- `POST /api/files/:id/story` — 1080×1920 (Instagram story)
- `POST /api/files/:id/cover` — 1080×1350 (Instagram feed post)
- `POST /api/files/:id/square` — 1080×1080
- `POST /api/files/:id/fb` — 1080×1080 (Facebook post)

Body accepts `operation`, `location`, `bedrooms`, `bathrooms`, `area`, and `amenities.{parking,garden,trees}`. Defaults assume a real-estate listing layout — customize [`src/services/cover-generator.js`](src/services/cover-generator.js) for a different vertical.

**Overlay** (session or API key)
- `POST /api/overlay/generate` — same body as cover generation plus optional `width`/`height` (default 1080×1920). Returns `image/png` with transparency — intended for FFmpeg compositing onto videos, not saved to luna.

**API keys** (session only)
- `GET /api/api-keys` — list (with client names and `revoked_at`). Active keys come first, revoked ones last.
- `POST /api/api-keys` — create, returns the raw key **once**; store it immediately
- `DELETE /api/api-keys/:id` — soft delete (sets `revoked_at` instead of removing the row). The key stops authenticating immediately, but the row sticks around so files uploaded by it still resolve to its name in `GET /files`. There is no "undelete".

API key header: `X-API-Key: <raw-key>`. Keys are tied to a single `client_id` — they can upload to, replace, delete, and generate covers from files of that client only.

## Storage standard

Every image upload is re-encoded to WebP and every video to MP4 (H.264 / AAC). This is the default for every client and applies regardless of input format:

| Input | Stored as | Notes |
|---|---|---|
| jpg, png, heic, heif, avif, webp | `.webp` | Re-encoded via `sharp`, EXIF auto-rotated |
| gif | `.webp` (animated) | Frames preserved with `animated: true` |
| mp4 | `.mp4` | Passthrough — no re-encoding |
| mov, webm, mkv | `.mp4` | Re-encoded with `ffmpeg` to H.264/AAC + faststart |
| anything else | as-is | Bytes copied verbatim |

The default image policy lives in `src/services/branding.js` as `DEFAULT_IMAGE_POLICY`: a 2048-on-the-longest-side full variant plus a 300px `-thumb` preview, both WebP at quality 82/78 with effort 6/4. Edit the constant if you want a different default for every client.

Cover generator output is also WebP. Video thumbnails stay JPEG (a single frame extracted at 1s by `ffmpeg`).

**Ephemeral clients bypass this entire pipeline** (see next section).

## Ephemeral clients

A client created with `is_ephemeral = 1` flips two switches:

1. **Passthrough uploads** — files are stored as-is with their original extension. PNG stays PNG, JPG stays JPG, MOV stays MOV. No `sharp`, no `ffmpeg`, no `-thumb` / `-md` variants. The original bytes go straight to disk under `{uuid}.{ext}`.
2. **24h auto-expire** — a background sweep (`src/services/file-expirer.js`, runs every 15 minutes via `setInterval`) deletes files whose `created_at` is older than 24 hours, along with all on-disk siblings. Cleanup re-uses the same `deleteFile()` path as manual deletion.

Created from the WUI with the small `▲` drop-up next to "+ New Client", or via the API:

```bash
curl -X POST https://luna.example.com/api/clients \
  -H 'Content-Type: application/json' \
  -d '{ "name": "demo-2026-05", "is_ephemeral": true }'
```

API keys work identically for ephemeral clients — same `POST /api/api-keys`, same `X-API-Key` header for uploads. Cover generation also works, but the generated cover inherits the ephemeral client's `client_id` and is therefore swept along with everything else 24h after it was created.

The drop-up, the calendar-clock icon next to the client's name in the sidebar / toolbar / API-keys page, and the per-file "expires in Xh Ym" badge in the gallery all key off the same `clients.is_ephemeral` flag. There is no per-file TTL override — every file in an ephemeral client follows the 24h rule.

## Branding and per-client overrides

`src/services/branding.js` loads an optional `src/services/branding.config.js` (gitignored) keyed by `client_id`. Copy [`branding.config.example.js`](src/services/branding.config.example.js) and fill in entries for your clients:

- **Cover generator config**: `logoIcon`, `logoWordmark`, `watermarkIcon`, `watermarkText`, `colors`, `formats`
- **`storagePolicy` override** (optional): replaces the default image policy for a single client. Same shape as `DEFAULT_IMAGE_POLICY`:

  ```js
  storagePolicy: {
    format: 'webp',
    variants: [
      { suffix: null,    width: 2048, height: 2048, fit: 'inside', quality: 82, effort: 6 },
      { suffix: 'md',    width: 800,  height: 800,  fit: 'inside', quality: 78, effort: 4 },
      { suffix: 'thumb', width: 300,  height: 300,  fit: 'cover',  quality: 75, effort: 2 },
    ],
  }
  ```

  `suffix: null` is the primary file (`{uuid}.webp`). Other suffixes generate sibling files (`{uuid}-md.webp`, etc). `fit: 'cover'` crops to fill; `'inside'` letterboxes within the box. `quality` is 1–100, `effort` is 0–6 (higher = slower encode, smaller file).

To get a client's id after creating them in the WUI: `sqlite3 /srv/media/db/luna-visor.sqlite "SELECT id, name FROM clients"`.

## File layout

All files live flat in `MEDIA_PATH/files/`, named by UUID:

```
{uuid}.webp            — full image (default policy: 2048×2048 inside)
{uuid}-thumb.webp      — 300px preview used by the WUI gallery
{uuid}.mp4             — video (re-encoded if input was non-mp4)
{uuid}-thumb.jpg       — video thumbnail (ffmpeg frame at 1s)
{uuid}-md.webp         — medium variant (only with custom policy that defines it)
{uuid}-normal.{ext}    — 300px preview for legacy jpg/png files (pre-WebP standard)
```

Files uploaded before the WebP/MP4 standard was rolled out keep their original extensions (`.jpg`, `.png`, etc.) and their preview is named `-normal.{ext}` (the old default suffix); their `cdn_url`s remain valid forever — there is no migration. New uploads, replacements, and generated covers follow the WebP/MP4 standard with `-thumb.webp` previews.

Client organization is logical — rows in the SQLite `clients` table. `mkdir` on disk does nothing.

## Development

```bash
node server.js   # restart by hand — no hot reload
```

Logs go to stdout. Under systemd, `journalctl -u luna-visor -f`.

No test suite yet. The app is deliberately small and file-level reading is usually enough to understand behavior.

## License

GNU Affero General Public License v3.0 — see [LICENSE](LICENSE).

In short: you can use, modify, and redistribute this freely, but any modified version you run as a network service must make its source available to the users of that service.
