# Admin API — Design Spec

**Date:** 2026-07-20
**Status:** Approved (approach A: admin keys inside the existing `api_keys` system)

## Purpose

Let the operator's AI agent (Claude on antares) onboard CDN clients autonomously: create a client, mint that client's API key, hand the key to the external app — without touching the WUI. Today `POST /api/clients` and `POST /api/api-keys` are session-only (`requireSession` at mount level in `server.js`), so no API key can perform onboarding.

## Scope

**In:** admin-flagged API keys; create + list for clients and api-keys via admin key; WUI support to mint/list admin keys; Caddy matcher update (incl. the pre-existing `/api/me` gap); `/api/me` admin branch; OpenAPI 1.5.0.

**Out (stays session/WUI-only):** rename/delete clients, rename/revoke keys, minting admin keys via API, any file operation with an admin key, file listing via admin key. Rationale: the agent adds, the human removes — leak blast radius is limited to junk creation, revocable instantly from the WUI.

## 1. DB migration

`api_keys` is rebuilt (SQLite cannot drop `NOT NULL` in place). Same idempotent pattern as the `files.type` CHECK rebuild in `connection.js`: check `sqlite_master.sql` for `is_admin`; if absent, rebuild inside a transaction with `foreign_keys = OFF`.

New canonical shape (also updated in `schema.sql` for fresh installs):

```sql
CREATE TABLE api_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    key_hash TEXT NOT NULL UNIQUE,
    key_preview TEXT NOT NULL,
    client_id INTEGER REFERENCES clients(id),      -- now nullable
    is_admin INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    revoked_at TEXT,
    CHECK ((is_admin = 1 AND client_id IS NULL) OR (is_admin = 0 AND client_id IS NOT NULL))
);
```

Existing rows are preserved verbatim (`is_admin` backfills to 0). The migration is tested against a copy of the production sqlite before deploying.

## 2. Auth middleware (`src/middleware/auth.js`)

- `findApiKey` SELECT gains `is_admin`.
- On successful key auth: `req.isAdminKey = row.is_admin === 1`; `req.apiKeyClientId` stays `null` for admin keys.
- New guard `requireSessionOrAdmin`: passes for `authMethod === 'session'` OR an admin key; otherwise 403.
- New guard `blockAdminKeys`: 403 for admin keys; mounted on `/api/files` and `/api/overlay` so an admin key gets an explicit "use a client key" error instead of an accidental 500 from a NULL `client_id`.
- `requireSession` unchanged.

## 3. Routes

Mount-level `requireSession` moves to per-route guards:

| Route | Guard |
|---|---|
| `GET /api/clients`, `POST /api/clients` | `requireSessionOrAdmin` |
| `PATCH /api/clients/:id`, `DELETE /api/clients/:id` | `requireSession` |
| `GET /api/api-keys`, `POST /api/api-keys` | `requireSessionOrAdmin` |
| `PATCH /api/api-keys/:id`, `DELETE /api/api-keys/:id` | `requireSession` |

- `POST /api/api-keys` accepts optional `is_admin: true` — **session-only** (403 for any API key, admin included: no escalation path). When `is_admin` is true, `client_id` must be absent; when false/absent, `client_id` required (unchanged).
- `GET /api/api-keys` switches `JOIN clients` → `LEFT JOIN clients` and exposes `is_admin` per row (admin keys have `client_name: null`).
- `POST /api/clients` unchanged — `is_ephemeral` already works, so the agent can create temp clients too.
- `clients.js` DELETE guard counts keys by `client_id` — admin keys (NULL) never block a client delete. No change needed.

## 4. WUI (API Keys page)

- The client `<select>` gains a first option "Admin — todos los clients". Choosing it submits `{ name, is_admin: true }` (no `client_id`).
- List rendering: `ADMIN` badge where the client name would go. Rename/revoke buttons work as-is (session endpoints).
- Bootstrap flow: the operator mints the first admin key in the WUI and hands it to antares Claude (suggested storage there: `~/.config/luna/keyring.env`, the existing keyring pattern).

## 5. Caddy (`/etc/caddy/conf.d/luna.solutions45.com`)

`@api_key` matcher paths gain the exact paths `/api/clients`, `/api/api-keys`, and `/api/me` (fixes the pre-existing gap where `/api/me` was documented as key-reachable but blocked by basic_auth). Only requests **with** `X-API-Key` match — browser traffic still hits basic_auth. `/:id` subpaths are deliberately NOT added: no key can use those routes.

## 6. `/api/me` admin branch (`src/routes/me.js`)

For admin keys, return admin context instead of client context: `{ api_key: { name, is_admin: true }, callable_endpoints: [clients GET/POST, api-keys GET/POST], notes }`. Client keys keep the current response shape untouched.

## 7. OpenAPI (`src/openapi.js`)

Document the new guard semantics on clients/api-keys GET+POST, the `is_admin` request/response fields, and the admin `/api/me` variant. Bump `info.version` 1.4.0 → 1.5.0.

## 8. Error handling

- Invalid/revoked key: 401 (existing behavior, unchanged).
- Client key on admin-gated route: 403 `Session or admin key required`.
- Admin key on session-only route: 403 (existing `requireSession` message).
- Admin key on file/overlay routes: 403 `Admin keys cannot access file endpoints; use a client-scoped key`.
- `is_admin: true` via API key auth: 403.
- `is_admin: true` + `client_id` both set: 400.

## 9. Test matrix (manual curl, post-deploy)

| Actor | Action | Expected |
|---|---|---|
| admin key | `POST /api/clients` | 201 (+ 409 dup) |
| admin key | `POST /api/clients` `is_ephemeral: true` | 201, flag set |
| admin key | `GET /api/clients`, `GET /api/api-keys` | 200 |
| admin key | `POST /api/api-keys` (client key) | 201, raw key once |
| admin key | `POST /api/api-keys` `is_admin: true` | 403 |
| admin key | `PATCH/DELETE /api/clients/:id`, `DELETE /api/api-keys/:id` | 401 from Caddy basic_auth (`/:id` paths deliberately not in the bypass matcher; Express `requireSession` 403 is the second line of defense) |
| admin key | `POST /api/files/upload`, `POST /api/overlay/generate` | 403 |
| admin key | `GET /api/me` | 200 admin context |
| client key | `POST /api/clients` | 403 (no regression) |
| client key | upload/replace/delete own files | unchanged |
| session | everything incl. mint admin key | unchanged + new option |
| Caddy | `/api/clients` with X-API-Key | reaches Express (no basic_auth) |
| Caddy | `/api/clients` without header | basic_auth prompt |
| migration | row count + hashes before/after | identical, `is_admin=0` backfilled |

## Deploy

`sudo systemctl restart luna-visor` + `sudo systemctl reload caddy`. Update project `CLAUDE.md` and persona `tools/luna-visor.md` after ship.
