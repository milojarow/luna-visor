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
- **Self-describing via OpenAPI 3.0.3**. A public `GET /api/openapi.json` endpoint serves the full spec — endpoints, schemas, security schemes — so an external client (a fresh LLM agent integrating from another repo, a Postman/Bruno user, an SDK generator) can onboard with a single fetch instead of needing the operator to paste docs.
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
    path /api/files /api/files/* /api/overlay/* /api/clients /api/clients/* /api/api-keys /api/api-keys/* /api/me
  }
  handle @api_key {
    reverse_proxy 127.0.0.1:3000
  }

  @openapi {
    path /api/openapi.json
  }
  handle @openapi {
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

If you add new API-key-accessible routes to the app, update the `@api_key` matcher accordingly. The separate `@openapi` matcher exists so the OpenAPI spec is **fully public** (no basic_auth, no API key required) — that's what makes single-curl agent onboarding possible. If you'd rather gate it behind an API key, drop the `@openapi` block and append `/api/openapi.json` to the `@api_key` matcher's path list instead.

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

All routes are under `/api`. Full details in [`src/routes/`](src/routes/), or fetch the OpenAPI spec for the machine-readable version.

**Discovery**
- `GET /api/openapi.json` — **public, no auth.** OpenAPI 3.0.3 specification. Describes every endpoint below, response shapes, security schemes (`apiKeyAuth` = `X-API-Key` header, `cookieAuth` = session). Source of truth is hand-written [`src/openapi.js`](src/openapi.js) — bump `info.version` (SemVer) when the contract changes.

- `GET /api/me` — **requires `X-API-Key`.** Per-key context derived from the calling key: the client it belongs to, the brand layout (`default` real-estate vs `minimal` logo+watermark), the cover formats enabled, the body shape the cover endpoint expects, the watermark text, the logo's CDN URL, and the exact list of callable endpoints. The external app calls this once at boot to know what it can do — no mental filtering of the global openapi spec required. Session callers get 403 (the WUI already shows everything).

  **Onboarding a new external client / agent** — give them three things and they bootstrap themselves:

  ```
  LUNA_BASE_URL=https://luna.example.com
  LUNA_API_KEY=<RAW_KEY>            # X-API-Key header, server-to-server only
  Start with: curl $LUNA_BASE_URL/api/me -H "X-API-Key: $LUNA_API_KEY"
  ```

  The key is the only secret. The spec itself is public on purpose; it describes the lock, not the key.

**Auth**
- `POST /api/auth/login` — body `{ password }`, sets session cookie
- `GET /api/auth/status` — returns `{ authenticated, cdn_base_url }`
- `POST /api/auth/logout`

**Clients** (create/list/rename: session or admin key; delete: session only)
- `GET /api/clients` — each row includes `is_ephemeral` and `preserve_format` (0 or 1)
- `POST /api/clients` — body `{ name, is_ephemeral?: boolean, preserve_format?: boolean }`. Both default `false`, both are create-time only
- `PATCH | DELETE /api/clients/:id` (delete blocked if client has files or active api keys)

**Files**
- `GET /api/files` — session sees all; client key sees its own vault (foreign `?client_id=` returns 403); admin key reads globally with optional `?client_id=`. Optional `limit` (capped at 500) and `offset`, no default cap. API-key results include `id`, `cdn_url`, `client_id`, original name and media metadata; admin also gets `client_name`. Upload attribution (`api_key_id`, `api_key_name`, `api_key_revoked_at`) is session-only.
- `GET /api/files/:id` — same read scope and projection; foreign-client access returns 403.
- `POST /api/files/upload` — multipart, field `files` (plural, repeatable), up to 20 × 500 MiB — session or client key; admin gets 403. Client key returns HTTP 201 with an array of `{cdn_url}` or `{error}` per input, NOT IDs. Inspect every item: 201 does not guarantee any or all files succeeded. Session returns full metadata or per-file errors. New files record the uploading key ID.
- `PATCH /api/files/:id` — move to another client (session)
- `POST /api/files/:id/copy` — copy to another client (session)
- `POST /api/files/:id/replace` — multipart, field `file` (singular) — same UUID, but extension and URL can change. Always use the returned `cdn_url`. HTTP 200 is an object `{cdn_url}` for a client key, full metadata for session. Session or client key (own vault only); admin gets 403. Keeps original `api_key_id` and `created_at`, so it does not renew ephemeral expiry. Processing happens under a temporary UUID before removing originals and renaming variants; this is NOT a full filesystem/DB transaction.
- `DELETE /api/files/:id` — session or API key (own client only)
- `POST /api/files/scan-references` — trigger log scan (session)

**Cover generation** (session or API key, own client only, format validated per client's brand config)
- `POST /api/files/:id/story` — 1080×1920 (Instagram story)
- `POST /api/files/:id/cover` — 1080×1350 (Instagram feed post)
- `POST /api/files/:id/square` — 1080×1080
- `POST /api/files/:id/fb` — 1080×1080 (Facebook post)
- `POST /api/files/:id/watermark` — anti-theft tiled text plus optional white logo, source dimensions preserved by the generator. Requires image source and `watermark` in the client's enabled formats (check `/api/me`). Optional JSON `{text, pattern_opacity, logo_opacity, logo_width_pct, logo_cx, logo_cy}`; numeric options are fractions clamped to 0..1, falling back to branding/defaults for non-finite values. `logo_opacity:0` omits the logo. No `position` or real-estate fields are required here. Saves a NEW UUID under the same vault, leaves the master intact; HTTP 201 `{cdn_url}` for client keys, full file for session. The generated WebP then follows the vault's storage policy (normal storage may resize it; raw/ephemeral keep it). 400 for non-image/disabled format, 401 for invalid auth, 403 for foreign scope/admin key, 404 for missing source, 429 for the shared 30/min cover limit, 500 for processing/storage failure. Overrides are not strictly type/range-validated; send numeric fractions and a string `text`.

Body shape depends on the client's `brand.layout`:

The layout-specific fields below apply to story/cover/square/fb, not watermark.
Watermark rendering limits source input to 50,000,000 pixels and applies a 30-second sharp timeout; this is not an end-to-end HTTP deadline.

- **`layout: 'default'`** (real-estate) — body accepts `operation`, `location`, `bedrooms`, `bathrooms`, `area`, and `amenities.{parking,garden,trees}`. Source is resized cover to the endpoint's W×H.
- **`layout: 'minimal'`** — logo in a corner + diagonal text watermark only. Body optional; accepts `{position}` to choose the corner (`top-right` default, `top-left`, `bottom-right`, `bottom-left`, or `none` to skip the logo and apply only the watermark). **Source dimensions are preserved** — the endpoint's W×H target is ignored. Use this layout when the caller already produces images at the target size and just wants branding overlaid.

Both layouts coexist in [`src/services/cover-generator.js`](src/services/cover-generator.js); the dispatcher is `generateCover` and reads `brand.layout` to switch.

**Overlay** (session or API key)
- `POST /api/overlay/generate` — same body as cover generation plus optional `width`/`height` (default 1080×1920). Returns `image/png` with transparency — intended for FFmpeg compositing onto videos, not saved to luna.

**API keys** (create/list: session or admin key; rename/revoke: session, or admin key for client-key targets)
- `GET /api/api-keys` — list (with client names, `is_admin`, and `revoked_at`). Active keys come first, revoked ones last.
- `POST /api/api-keys` — create, returns the raw key **once**; store it immediately. Body `{ name, client_id }`, or `{ name, is_admin: true }` for an admin key (**session only** — API-key callers get 403, so an admin key can never mint another admin key).
- `DELETE /api/api-keys/:id` — soft delete (sets `revoked_at` instead of removing the row). Session, or admin key (**client keys only** — revoking an admin key via API returns 403). The key stops authenticating immediately, but the row sticks around so files uploaded by it still resolve to its name in `GET /files`. There is no "undelete".

API key header: `X-API-Key: <raw-key>`. Client-scoped keys are tied to a single `client_id` — they can upload to, replace, delete, and generate covers from files of that client only.

**Admin API keys** — onboarding credentials for an external orchestrator (e.g. an AI agent that provisions new clients). `is_admin = 1`, `client_id NULL`. They can create, list, and rename clients and API keys, and **revoke client keys** — the full lifecycle (create client → mint its key → hand the key to the app → rename/revoke on rotation) with zero WUI involvement. They can read file metadata globally via `GET /api/files` and `GET /api/files/:id`, but cannot write files, generate covers, or generate overlays (explicit 403), cannot delete clients, cannot mint more admin keys, and cannot rename or revoke admin keys (including themselves) — admin keys are WUI-managed, so a leaked admin key can never lock the human out. Mint one from the WUI's API Keys page via the "Admin — todos los clients" option, and call `GET /api/me` with it to self-discover the callable surface.

## Storage standard

Every image upload is re-encoded to WebP and every video to MP4 (H.264 / AAC). This is the default for every client and applies regardless of input format:

| Input | Stored as | Notes |
|---|---|---|
| jpg, png, heic, heif, avif, webp | `.webp` | Re-encoded via `sharp`, EXIF auto-rotated |
| gif | `.webp` (animated) | Frames preserved with `animated: true` |
| mp4 | `.mp4` | Passthrough — no re-encoding |
| mov, webm, mkv | `.mp4` | Re-encoded with `ffmpeg` to H.264/AAC + faststart |
| svg | `.svg` | Passthrough — XML content validated (first 512 bytes must start with `<svg`/`<?xml`) |
| mp3 | `.mp3` | Passthrough |
| lottie | `.lottie` | Passthrough — bytes preserved exactly. Both dotLottie (ZIP archive) and raw Bodymovin JSON are accepted; the validator sniffs magic bytes (`PK\x03\x04` for ZIP, JSON-parse for the rest with a sanity check on lottie schema fields). No thumbnail, no variants — the animation runtime needs the original bytes. |

Everything else is rejected by `src/services/upload-validator.js`. Replace returns 400 for invalid input; batch upload reports per-file `{error}` entries in its 201 array, not a request-wide 400 for each item.

The default image policy lives in `src/services/branding.js` as `DEFAULT_IMAGE_POLICY`: a 2048-on-the-longest-side full variant plus a 300px `-thumb` preview, both WebP at quality 82/78 with effort 6/4. Edit the constant if you want a different default for every client.

Cover generator output is also WebP. Video thumbnails stay JPEG (a single frame extracted at 1s by `ffmpeg`).

**Two per-client flags bypass this entire pipeline** — `preserve_format` and `is_ephemeral` (see the next two sections).

## Preserve-format vaults

A client created with `preserve_format = 1` stores every upload **byte-for-byte**: same extension, same bytes, no `sharp`, no `ffmpeg`, no `-thumb` / `-md` variants. PNG stays PNG, JPG stays JPG, MOV stays MOV. Unless `is_ephemeral` is also set, nothing expires — the files live until someone deletes them.

Created from the WUI with the `▲` drop-up next to "+ New Client" ("Vault sin conversión"), or via the API with a session or an **admin key**:

```bash
curl -X POST https://luna.example.com/api/clients \
  -H "X-API-Key: $LUNA_ADMIN_KEY" -H 'Content-Type: application/json' \
  -d '{ "name": "masters", "preserve_format": true }'
```

What it does *not* change:

- **The allowlist still applies.** `upload-validator.js` rejects anything outside the supported extension list with a 400 — passthrough is not "accepts any file".
- **The gallery has no thumbnails to show.** Images render from the original (heavier previews); video and everything else fall back to the placeholder card.
- **`replaceFile` inherits it** — replacing a file in a preserve-format vault keeps the new file raw too, same UUID.

It is orthogonal to `is_ephemeral`: that one controls the 24h TTL, this one controls transcoding. A client can carry both (raw storage *and* auto-expiry). Neither can be flipped afterwards — `PATCH /api/clients/:id` only renames.

## Ephemeral clients

A client created with `is_ephemeral = 1` flips two switches:

1. **Passthrough uploads** — same byte-for-byte storage as a preserve-format vault (above).
2. **24h auto-expire** — a background sweep (`src/services/file-expirer.js`, runs at boot and every 15 minutes via `setInterval`) deletes files whose `created_at` is older than 24 hours, along with all on-disk siblings. Cleanup re-uses the same `deleteFile()` path as manual deletion. Expiry occurs on the next running sweep, not exactly at 24h. Replace does not change `created_at` or renew the TTL. Raw/ephemeral still reject unsupported extensions and invalid content.

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

- **Common to all layouts**: `name`, `formats` (allowed cover format names), `storagePolicy` (optional).
- **`layout: 'default'` (real-estate)** — SVG-composed cover with info pills, gradient dim, operation/location text. Fields: `logoIcon`, `logoWordmark`, `watermarkIcon`, `watermarkText`, `watermarkFont`, `colors.{primary,dark,accent}`.
- **`layout: 'minimal'`** — logo in a corner + diagonal text watermark only, source dimensions preserved. Fields: `logoImagePath` (absolute path to a raster file, typically one already uploaded to luna under `/srv/media/files/<uuid>.<ext>`), `logoSize` (default 200), `logoMargin` (default 30), `logoRadius` (default 28), `watermarkText`, `watermarkFont`, `watermarkOpacity` (default 0.18).
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

Run the Node test suite with isolated SQLite and generated media, never `/srv/media`:

```bash
SCRATCHPAD=$(mktemp -d "${TMPDIR:?}/luna-tests.XXXXXX")
MEDIA_PATH="$SCRATCHPAD/media" SCRATCHPAD="$SCRATCHPAD" npm test
```

Tests cover authentication/authorization, client and partner scopes, migrations, normal/raw/ephemeral storage, API response shapes, replacement/expiry, watermark, and OpenAPI versus `/me` discovery. Inputs are generated in scratch; do not commit multimedia fixtures. Luna is the sole multimedia host: use CDN URLs, not GitHub/Vercel assets, and search existing files before uploading duplicates.

Optional UI browser check: with Playwright installed outside this checkout, run `NODE_PATH=/path/to/node_modules SCRATCHPAD=/your/scratch node scripts/check-api-keys-ui.js`. It renders the real API-key list with explicitly synthetic admin/client/revoked rows, checks desktop/mobile layout, action callbacks, keyboard focus and gold text contrast, and writes screenshots only to scratch. `--base-url http://127.0.0.1:3000` additionally checks that deployed CSS/JS match the checkout. Set `CHROMIUM_PATH` if using an existing Chromium binary. No login, raw keys or API writes are used.

## License

GNU Affero General Public License v3.0 — see [LICENSE](LICENSE).

In short: you can use, modify, and redistribute this freely, but any modified version you run as a network service must make its source available to the users of that service.
