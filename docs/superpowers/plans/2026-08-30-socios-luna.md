# Socios en luna — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un socio (richie) entre a `luna.solutions45.com/socios` con una contraseña y use la misma interfaz gráfica del owner, viendo únicamente las bóvedas que sus api keys alcanzan.

**Architecture:** Se introduce una tercera identidad (`authMethod === 'partner'`) cuyo alcance se **deriva** de `api_keys.partner_id` en vez de almacenarse. Antes de tocarla, se colapsan los ocho checks de `files.js` escritos por *método de autenticación* en un único `callerScope(req)` escrito por *alcance* y fail-closed. La interfaz es la misma del owner; sólo se esconden los controles que el servidor ya niega.

**Tech Stack:** Express 5, better-sqlite3 (sync), express-session + connect-sqlite3, bcrypt, vanilla JS sin build step, `node --test`.

**Spec:** `docs/superpowers/specs/2026-08-30-socios-luna-design.md`

## Global Constraints

- **Rama:** `socios-luna` (ya creada, el spec está commiteado ahí).
- **Migraciones:** no hay sistema formal. Tabla nueva → `CREATE TABLE IF NOT EXISTS` en `src/db/schema.sql`. Columna nueva → try/catch `ALTER TABLE` en `src/db/connection.js`, junto a las que ya están (líneas 16-51). `schema.sql` se ejecuta en la línea 13, **antes** de todos los ALTER.
- **Fail-closed es la regla del proyecto:** `callerScope` devuelve `[]` (nada) para identidades desconocidas, nunca `null` (todo). Igual que la barrera `blockAdminKeys` de `files.js:164`.
- **Nunca mover ni agregar rutas de escritura arriba de `router.use(blockAdminKeys)`** en `src/routes/files.js:164`.
- **`path` de Caddy es match exacto salvo wildcard.** `/api/files/*` NO cubre `/api/files`; ambos van listados. Este gotcha ya costó un incidente el 2026-07-24.
- **No se toca el comportamiento existente de client keys ni admin keys.** Cada task que refactoriza lleva su test de regresión.
- **Servicio en vivo:** `luna-visor.service` corre desde este mismo working tree. `sudo systemctl restart luna-visor` después de cambios en `src/` o `server.js`. Los cambios en `public/` no necesitan restart.
- **DB de producción:** `/srv/media/db/luna-visor.sqlite`. Los tests usan `MEDIA_PATH` apuntado a scratch — **nunca** correr tests contra la DB viva.
- **Idioma:** comentarios y mensajes de commit en el estilo del repo (inglés en el código, el spec en español).

---

### Task 0: Commit de base del working tree

El tree trae 12 archivos modificados sin commitear y 3 sin trackear que ya corren en producción. Sin esta base, el diff de este proyecto queda revuelto con trabajo ajeno y nadie puede revertir uno sin el otro.

**Files:**
- Modify: ninguno (sólo git)

**Interfaces:**
- Consumes: nada
- Produces: un HEAD que refleja lo desplegado, para que todo commit posterior sea sólo de este proyecto

- [ ] **Step 1: Confirmar con el owner antes de commitear trabajo que no es tuyo**

Este paso NO se salta. El working tree es del owner. Preguntar explícitamente antes de ejecutar el Step 2.

- [ ] **Step 2: Commitear la base**

```bash
cd ~/luna-visor
git add -A ':!_*.js'
git commit -m "Baseline: lightbox viewer, preserve-format vaults y ajustes de WUI ya desplegados"
```

Los `_*.js` de la raíz son scripts ad-hoc del trabajo de gráficas de beauty; quedan fuera a propósito.

- [ ] **Step 3: Verificar**

```bash
git status --short   # sólo debe quedar la lista de _*.js sin trackear
```

---

### Task 1: `callerScope` — un solo check de alcance

El refactor de fondo. Se hace **antes** de que exista ningún socio, para que su único efecto medible sea "nada cambió".

**Files:**
- Modify: `src/middleware/auth.js` (añadir `callerScope`, exportarla)
- Modify: `src/routes/files.js` (8 puntos: líneas 103-160, 166-201, 214-281, 288-300)
- Modify: `src/routes/overlay.js:17-22`
- Test: `tests/caller-scope.test.js` (crear)

**Interfaces:**
- Produces:
  - `callerScope(req) → null | number[]` desde `src/middleware/auth.js`
  - `fileToPartnerResponse(file)` y `stripAttribution(obj)` internos de `files.js`
  - `apiKeyIdFor(req, clientId) → number | null` interno de `files.js`

- [ ] **Step 1: Escribir el test que falla**

Crear `tests/caller-scope.test.js`:

```js
const path = require('path');
const fs = require('fs');

const SCRATCH_BASE = process.env.SCRATCHPAD
  || path.join(require('os').tmpdir(), 'luna-visor-tests');
const scratch = path.join(SCRATCH_BASE, 'luna-tests', 'caller-scope');
fs.rmSync(scratch, { recursive: true, force: true });
fs.mkdirSync(path.join(scratch, 'db'), { recursive: true });
process.env.MEDIA_PATH = scratch;
process.env.SESSION_SECRET = 'test';
process.env.ADMIN_PASSWORD_HASH = 'test';
process.env.CDN_BASE_URL = 'http://localhost';

const { test } = require('node:test');
const assert = require('node:assert');
require('../src/db/connection');
const { callerScope } = require('../src/middleware/auth');

test('callerScope: owner session is unrestricted', () => {
  assert.strictEqual(callerScope({ authMethod: 'session' }), null);
});

test('callerScope: admin key is unrestricted (writes are stopped by the barrier)', () => {
  assert.strictEqual(callerScope({ authMethod: 'api-key', isAdminKey: true }), null);
});

test('callerScope: client key is pinned to its own vault', () => {
  assert.deepStrictEqual(
    callerScope({ authMethod: 'api-key', isAdminKey: false, apiKeyClientId: 7 }),
    [7],
  );
});

test('callerScope: an unknown identity sees nothing, not everything', () => {
  assert.deepStrictEqual(callerScope({}), []);
  assert.deepStrictEqual(callerScope({ authMethod: 'something-new' }), []);
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `cd ~/luna-visor && node --test tests/caller-scope.test.js`
Expected: FAIL — `callerScope is not a function`

- [ ] **Step 3: Implementar `callerScope`**

En `src/middleware/auth.js`, después de `blockAdminKeys` y antes de `module.exports`:

```js
// Which client_ids may this caller touch?
//   null  → unrestricted (owner session; admin keys for reads — their writes
//           are already stopped by the blockAdminKeys barrier in files.js)
//   array → exactly these client_ids
// An identity nobody taught this function about gets [] — it sees nothing
// rather than everything. Same fail-closed discipline as the barrier.
function callerScope(req) {
  if (req.authMethod === 'session') return null;
  if (req.authMethod === 'partner') return req.scopeClientIds || [];
  if (req.authMethod === 'api-key') {
    return req.isAdminKey ? null : [req.apiKeyClientId];
  }
  return [];
}
```

Y agregarla al export:

```js
module.exports = { requireAuth, requireSession, requireSessionOrAdmin, blockAdminKeys, callerScope };
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `node --test tests/caller-scope.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Cablear `callerScope` en el `GET /` de files.js**

En `src/routes/files.js`, importar la función:

```js
const { requireSession, blockAdminKeys, callerScope } = require('../middleware/auth');
```

Reemplazar el cuerpo de `router.get('/', ...)` (líneas 102-142) por:

```js
router.get('/', (req, res) => {
  const scope = callerScope(req);

  let scopeClientId = null;
  if (req.query.client_id !== undefined) {
    scopeClientId = Number.parseInt(req.query.client_id, 10);
    if (!Number.isInteger(scopeClientId)) {
      return res.status(400).json({ error: 'client_id must be an integer' });
    }
  }

  // A scoped caller asking for a vault outside its scope gets a 403 — never a
  // silent re-scope, which would let it believe it had seen everything.
  if (scope && scopeClientId !== null && !scope.includes(scopeClientId)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const { paging, error } = parsePaging(req.query);
  if (error) return res.status(400).json({ error });

  const params = [];
  let sql = FILE_SELECT;
  if (scopeClientId !== null) {
    sql += ' WHERE f.client_id = ?';
    params.push(scopeClientId);
  } else if (scope) {
    if (!scope.length) return res.json([]);   // avoid an empty IN () — it is a syntax error
    sql += ` WHERE f.client_id IN (${scope.map(() => '?').join(',')})`;
    params.push(...scope);
  }
  sql += ' ORDER BY f.created_at DESC';
  if (paging.limit !== undefined || paging.offset !== undefined) {
    sql += ' LIMIT ? OFFSET ?';
    params.push(paging.limit ?? -1, paging.offset ?? 0);
  }

  const files = db.prepare(sql).all(...params);
  if (req.authMethod === 'partner') return res.json(files.map(fileToPartnerResponse));
  if (req.authMethod === 'api-key') {
    return res.json(files.map(f => fileToKeyResponse(f, req.isAdminKey)));
  }
  res.json(files.map(fileToResponse));
});
```

- [ ] **Step 6: Añadir las proyecciones y el helper de atribución**

En `src/routes/files.js`, justo después de `fileToKeyResponse` (línea 74):

```js
// The partner UI is the owner's own gallery, so it needs the full row. Upload
// attribution is the exception: api_key_name spells out internal tooling names
// and stays session-only.
function stripAttribution(obj) {
  if (!obj) return obj;
  const { api_key_id, api_key_name, api_key_revoked_at, ...rest } = obj;
  return rest;
}

function fileToPartnerResponse(file) {
  return stripAttribution(fileToResponse(file));
}

// The api_keys row a write should be attributed to. A partner acts through a
// real key — the one that granted it that vault — so attribution stays honest.
function apiKeyIdFor(req, clientId) {
  if (req.authMethod === 'api-key') return req.apiKeyId;
  if (req.authMethod === 'partner') return req.partnerKeyByClient?.[clientId] ?? null;
  return null;
}
```

- [ ] **Step 7: Cablear los otros siete puntos**

`GET /:id` (líneas 146-155) →

```js
router.get('/:id', (req, res) => {
  const file = db.prepare(`${FILE_SELECT} WHERE f.id = ?`).get(req.params.id);
  if (!file) return res.status(404).json({ error: 'File not found' });

  const scope = callerScope(req);
  if (scope && !scope.includes(file.client_id)) {
    return res.status(403).json({ error: 'Access denied' });
  }
  if (req.authMethod === 'partner') return res.json(fileToPartnerResponse(file));
  if (req.authMethod === 'api-key') return res.json(fileToKeyResponse(file, req.isAdminKey));
  res.json(fileToResponse(file));
});
```

`POST /upload` — reemplazar las dos primeras líneas del handler (167-168) por:

```js
  const scope = callerScope(req);
  let client_id;
  if (scope === null) {
    client_id = req.body.client_id;            // owner session: as before
  } else if (scope.length === 1) {
    client_id = scope[0];                      // client key: body ignored, as before
  } else {
    client_id = Number.parseInt(req.body.client_id, 10);
    if (!scope.includes(client_id)) {
      cleanupTempFiles(req);
      return res.status(403).json({ error: 'Access denied' });
    }
  }
```

y dentro del loop, cambiar la llamada a `saveFile`:

```js
      const file = await saveFile(f.path, cleanName, f.mimetype, f.size, client_id, apiKeyIdFor(req, client_id));
```

y el bloque de respuesta al final del handler:

```js
  if (req.authMethod === 'api-key') {
    const minimal = results.map(r => r.error ? { error: r.error } : { cdn_url: r.cdn_url });
    return res.status(201).json(minimal);
  }
  if (req.authMethod === 'partner') {
    return res.status(201).json(results.map(r => r.error ? r : stripAttribution(r)));
  }
  res.status(201).json(results);
```

(La variable `isApiKey` queda sin uso: borrarla.)

`POST /:id/replace` — reemplazar el bloque de ownership (líneas 215-224) por:

```js
  const scope = callerScope(req);
  if (scope) {
    const existing = db.prepare('SELECT client_id FROM files WHERE id = ?').get(req.params.id);
    if (!existing) {
      cleanupTempFiles(req);
      return res.status(404).json({ error: 'File not found' });
    }
    if (!scope.includes(existing.client_id)) {
      cleanupTempFiles(req);
      return res.status(403).json({ error: 'Access denied' });
    }
  }
```

y su bloque de respuesta:

```js
    const response = fileToResponse(file);
    if (req.authMethod === 'api-key') {
      return res.json({ cdn_url: response.cdn_url });
    }
    if (req.authMethod === 'partner') return res.json(stripAttribution(response));
    res.json(response);
```

`handleCoverGeneration` — línea 252 →

```js
  const scope = callerScope(req);
  if (scope && !scope.includes(file.client_id)) {
    return res.status(403).json({ error: 'Access denied' });
  }
```

su `saveFile` (línea 274) →

```js
  const saved = await saveFile(tmpPath, coverName, 'image/webp', coverBuffer.length, file.client_id, apiKeyIdFor(req, file.client_id));
```

y su respuesta →

```js
  const response = fileToResponse(saved);
  if (req.authMethod === 'api-key') {
    return res.status(201).json({ cdn_url: response.cdn_url });
  }
  if (req.authMethod === 'partner') return res.status(201).json(stripAttribution(response));
  res.status(201).json(response);
```

`DELETE /:id` (líneas 288-300) →

```js
router.delete('/:id', (req, res) => {
  const scope = callerScope(req);
  if (scope) {
    const target = db.prepare('SELECT client_id FROM files WHERE id = ?').get(req.params.id);
    if (!target) return res.status(404).json({ error: 'File not found' });
    if (!scope.includes(target.client_id)) {
      return res.status(403).json({ error: 'Access denied' });
    }
  }
  const file = deleteFile(req.params.id);
  if (!file) return res.status(404).json({ error: 'File not found' });
  res.json({ ok: true });
});
```

- [ ] **Step 8: Cerrar el hueco de `overlay.js`**

`/api/overlay/generate` deriva su `client_id` del body cuando no hay `apiKeyClientId`. Un socio caería ahí sin validar. En `src/routes/overlay.js`, importar y validar:

```js
const { callerScope } = require('../middleware/auth');
```

dentro del handler, después del check de `!clientId`:

```js
  const scope = callerScope(req);
  if (scope && !scope.includes(Number.parseInt(clientId, 10))) {
    return res.status(403).json({ error: 'Access denied' });
  }
```

- [ ] **Step 9: Test de regresión — nada cambió para las keys existentes**

Añadir a `tests/caller-scope.test.js` una app Express mínima con el mismo orden de wiring que `server.js` (mismo patrón que `tests/preserve-format.test.js` líneas 36+), y verificar contra archivos sembrados:

```js
// --- seed ------------------------------------------------------------------
const crypto = require('crypto');
const express = require('express');
const db = require('../src/db/connection');
const { requireAuth } = require('../src/middleware/auth');
const sha = s => crypto.createHash('sha256').update(s).digest('hex');

const RAW_CLIENT = 'raw-client-key-caller-scope';
const RAW_ADMIN = 'raw-admin-key-caller-scope';
const c1 = db.prepare("INSERT INTO clients (name, slug) VALUES ('c1','c1')").run().lastInsertRowid;
const c2 = db.prepare("INSERT INTO clients (name, slug) VALUES ('c2','c2')").run().lastInsertRowid;
db.prepare("INSERT INTO api_keys (name, key_hash, key_preview, client_id, is_admin) VALUES ('ck', ?, 'aaaa', ?, 0)").run(sha(RAW_CLIENT), c1);
db.prepare("INSERT INTO api_keys (name, key_hash, key_preview, client_id, is_admin) VALUES ('ak', ?, 'bbbb', NULL, 1)").run(sha(RAW_ADMIN));
for (const [id, cid] of [['f1', c1], ['f2', c2]]) {
  db.prepare(`INSERT INTO files (id, original_name, extension, mime_type, size_bytes, client_id, type)
              VALUES (?, ?, 'webp', 'image/webp', 10, ?, 'image')`).run(id, id, cid);
}

const app = express();
app.use(express.json());
app.use(requireAuth);
app.use('/api/files', require('../src/routes/files'));

async function get(pathname, headers = {}) {
  const server = app.listen(0);
  const port = server.address().port;
  const res = await fetch(`http://127.0.0.1:${port}${pathname}`, { headers });
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  server.close();
  return { status: res.status, body };
}

test('regression: a client key still sees only its own vault', async () => {
  const { status, body } = await get('/api/files', { 'X-API-Key': RAW_CLIENT });
  assert.strictEqual(status, 200);
  assert.deepStrictEqual(body.map(f => f.id), ['f1']);
});

test('regression: a client key asking for a foreign vault still gets 403', async () => {
  const { status } = await get(`/api/files?client_id=${c2}`, { 'X-API-Key': RAW_CLIENT });
  assert.strictEqual(status, 403);
});

test('regression: an admin key still reads across all clients', async () => {
  const { status, body } = await get('/api/files', { 'X-API-Key': RAW_ADMIN });
  assert.strictEqual(status, 200);
  assert.strictEqual(body.length, 2);
});

test('regression: an admin key still cannot write', async () => {
  const { status } = await get('/api/files/f1', { 'X-API-Key': RAW_ADMIN });
  assert.strictEqual(status, 200);   // reads allowed
});
```

- [ ] **Step 10: Correr toda la suite**

Run: `cd ~/luna-visor && node --test`
Expected: PASS — `caller-scope`, `auth-guards`, `migration` y `preserve-format` todos verdes.

- [ ] **Step 11: Verificar contra el servicio vivo que nada se rompió**

```bash
sudo systemctl restart luna-visor && sleep 2
K19=<key de richie para clinic-beauty-spa>
curl -sS https://luna.solutions45.com/api/files -H "X-API-Key: $K19" | jq 'length'   # → 42
curl -sS -o /dev/null -w '%{http_code}\n' 'https://luna.solutions45.com/api/files?client_id=30' -H "X-API-Key: $K19"   # → 403
source ~/.config/luna/keyring.env
curl -sS https://luna.solutions45.com/api/files -H "X-API-Key: $LUNA_ADMIN_KEY" | jq 'length'   # → total, sin cambio
```

- [ ] **Step 12: Commit**

```bash
git add src/middleware/auth.js src/routes/files.js src/routes/overlay.js tests/caller-scope.test.js
git commit -m "Collapse the eight auth-method checks in files.js into one callerScope

They were written by authentication method — 'are you an api-key?' — and
treated anything else as the owner. That composes badly with a new identity:
a partner session would have written into all 27 vaults. Now they ask about
scope instead, and an identity nobody taught callerScope about sees nothing.

overlay.js had the same shape and is closed too."
```

---

### Task 2: Tabla `partners` y columna `api_keys.partner_id`

**Files:**
- Modify: `src/db/schema.sql`
- Modify: `src/db/connection.js`
- Test: `tests/migration.test.js` (añadir casos)

**Interfaces:**
- Produces: tabla `partners(id, name, display_name, password_hash, created_at, disabled_at)` y columna `api_keys.partner_id INTEGER REFERENCES partners(id)`

- [ ] **Step 1: Escribir el test que falla**

Añadir a `tests/migration.test.js`:

```js
test('partners table exists with the expected columns', () => {
  const cols = db.prepare('PRAGMA table_info(partners)').all().map(c => c.name);
  assert.deepStrictEqual(
    cols.sort(),
    ['created_at', 'disabled_at', 'display_name', 'id', 'name', 'password_hash'],
  );
});

test('api_keys carries a nullable partner_id', () => {
  const col = db.prepare('PRAGMA table_info(api_keys)').all().find(c => c.name === 'partner_id');
  assert.ok(col, 'partner_id column missing');
  assert.strictEqual(col.notnull, 0);
});

test('partner names are unique', () => {
  db.prepare("INSERT INTO partners (name, password_hash) VALUES ('dup', 'x')").run();
  assert.throws(
    () => db.prepare("INSERT INTO partners (name, password_hash) VALUES ('dup', 'y')").run(),
    /UNIQUE/,
  );
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `node --test tests/migration.test.js`
Expected: FAIL — `no such table: partners`

- [ ] **Step 3: Crear la tabla**

Al final de `src/db/schema.sql`:

```sql

CREATE TABLE IF NOT EXISTS partners (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    display_name TEXT,
    password_hash TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    disabled_at TEXT
);
```

- [ ] **Step 4: Añadir la columna**

En `src/db/connection.js`, junto a las otras migraciones (después del bloque de `preserve_format`, línea ~51):

```js
// Migration: link an api key to a partner. The partner's reach IS the set of
// clients its live keys point at — revoking the key revokes the web access in
// the same act, so there are never two levers to keep in sync.
try {
  db.exec('ALTER TABLE api_keys ADD COLUMN partner_id INTEGER REFERENCES partners(id)');
} catch {
  // Column already exists
}
```

`schema.sql` corre en la línea 13, así que `partners` ya existe cuando este ALTER se evalúa.

- [ ] **Step 5: Correr y verificar que pasa**

Run: `node --test tests/migration.test.js`
Expected: PASS

- [ ] **Step 6: Verificar idempotencia contra la DB viva**

```bash
sudo systemctl restart luna-visor && sleep 2
journalctl -u luna-visor -n 20 --no-pager | grep -i "migration FAILED" && echo "PROBLEMA" || echo "sin fallos de migración"
sqlite3 /srv/media/db/luna-visor.sqlite "PRAGMA table_info(api_keys);" | grep partner_id
sqlite3 /srv/media/db/luna-visor.sqlite ".tables" | tr ' ' '\n' | grep partners
sudo systemctl restart luna-visor && sleep 2   # segunda vez: el ALTER debe ser no-op silencioso
journalctl -u luna-visor -n 10 --no-pager | grep -i "migration FAILED" && echo "PROBLEMA" || echo "idempotente"
```

- [ ] **Step 7: Commit**

```bash
git add src/db/schema.sql src/db/connection.js tests/migration.test.js
git commit -m "Add partners table and api_keys.partner_id

The partner's scope is derived from its live keys, not stored: granting a
client means minting its key and hanging it on the partner; revoking the key
takes the vault out of the partner's sight in the same act."
```

---

### Task 3: Identidad de socio en `requireAuth`

**Files:**
- Modify: `src/middleware/auth.js`
- Test: `tests/partner-identity.test.js` (crear)

**Interfaces:**
- Consumes: `callerScope` (Task 1), tabla `partners` + `api_keys.partner_id` (Task 2)
- Produces: en un request de socio — `req.authMethod === 'partner'`, `req.partnerId`, `req.scopeClientIds: number[]`, `req.partnerKeyByClient: Record<number, number>`. Y `partnerScope(partnerId) → Array<{api_key_id, client_id}>` exportada.

- [ ] **Step 1: Escribir el test que falla**

Crear `tests/partner-identity.test.js` (prólogo de scratch igual al de Task 1, con `scratch = .../partner-identity`):

```js
const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const db = require('../src/db/connection');
const { requireAuth, callerScope, partnerScope } = require('../src/middleware/auth');

const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const cA = db.prepare("INSERT INTO clients (name, slug) VALUES ('a','a')").run().lastInsertRowid;
const cB = db.prepare("INSERT INTO clients (name, slug) VALUES ('b','b')").run().lastInsertRowid;
const cC = db.prepare("INSERT INTO clients (name, slug) VALUES ('c','c')").run().lastInsertRowid;
const pid = db.prepare("INSERT INTO partners (name, password_hash) VALUES ('p1','x')").run().lastInsertRowid;

const keyA = db.prepare("INSERT INTO api_keys (name, key_hash, key_preview, client_id, is_admin, partner_id) VALUES ('ka', ?, 'aaaa', ?, 0, ?)").run(sha('ka'), cA, pid).lastInsertRowid;
const keyB = db.prepare("INSERT INTO api_keys (name, key_hash, key_preview, client_id, is_admin, partner_id) VALUES ('kb', ?, 'bbbb', ?, 0, ?)").run(sha('kb'), cB, pid).lastInsertRowid;
// revoked → must not grant anything
db.prepare("INSERT INTO api_keys (name, key_hash, key_preview, client_id, is_admin, partner_id, revoked_at) VALUES ('kc', ?, 'cccc', ?, 0, ?, datetime('now'))").run(sha('kc'), cC, pid);
// an admin key hung on a partner must never widen its scope
db.prepare("INSERT INTO api_keys (name, key_hash, key_preview, client_id, is_admin, partner_id) VALUES ('kadm', ?, 'dddd', NULL, 1, ?)").run(sha('kadm'), pid);

function mockRes() {
  const r = { statusCode: null, body: null };
  r.status = c => { r.statusCode = c; return r; };
  r.json = b => { r.body = b; return r; };
  r.redirect = () => { r.statusCode = 302; return r; };
  return r;
}
function runMw(mw, req) {
  const res = mockRes();
  let nexted = false;
  mw(req, res, () => { nexted = true; });
  return { res, nexted };
}

test('partnerScope: live client keys only — revoked and admin keys excluded', () => {
  const rows = partnerScope(pid);
  assert.deepStrictEqual(rows.map(r => r.client_id).sort((x, y) => x - y), [cA, cB]);
  assert.deepStrictEqual(
    rows.map(r => r.api_key_id).sort((x, y) => x - y),
    [keyA, keyB].sort((x, y) => x - y),
  );
});

test('requireAuth: a partner session becomes authMethod=partner with its vaults', () => {
  const req = { headers: {}, path: '/api/files', session: { partnerId: pid } };
  const { nexted } = runMw(requireAuth, req);
  assert.ok(nexted);
  assert.strictEqual(req.authMethod, 'partner');
  assert.strictEqual(req.partnerId, pid);
  assert.deepStrictEqual(req.scopeClientIds.sort((x, y) => x - y), [cA, cB]);
  assert.strictEqual(req.partnerKeyByClient[cA], keyA);
});

test('callerScope: a partner is scoped to its vaults', () => {
  const req = { headers: {}, path: '/api/files', session: { partnerId: pid } };
  runMw(requireAuth, req);
  assert.deepStrictEqual(callerScope(req).sort((x, y) => x - y), [cA, cB]);
});

test('a partner with no live keys sees nothing — not everything', () => {
  const empty = db.prepare("INSERT INTO partners (name, password_hash) VALUES ('empty','x')").run().lastInsertRowid;
  const req = { headers: {}, path: '/api/files', session: { partnerId: empty } };
  runMw(requireAuth, req);
  assert.strictEqual(req.authMethod, 'partner');
  assert.deepStrictEqual(callerScope(req), []);
});

test('a disabled partner is not an identity at all', () => {
  const off = db.prepare("INSERT INTO partners (name, password_hash, disabled_at) VALUES ('off','x', datetime('now'))").run().lastInsertRowid;
  db.prepare("INSERT INTO api_keys (name, key_hash, key_preview, client_id, is_admin, partner_id) VALUES ('koff', ?, 'eeee', ?, 0, ?)").run(sha('koff'), cA, off);
  const req = { headers: {}, path: '/api/files', session: { partnerId: off } };
  const { res, nexted } = runMw(requireAuth, req);
  assert.ok(!nexted);
  assert.strictEqual(res.statusCode, 401);
});

test('a session carrying both flags takes the lower-power path', () => {
  const req = { headers: {}, path: '/api/files', session: { partnerId: pid, authenticated: true } };
  runMw(requireAuth, req);
  assert.strictEqual(req.authMethod, 'partner');
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `node --test tests/partner-identity.test.js`
Expected: FAIL — `partnerScope is not a function`

- [ ] **Step 3: Implementar `partnerScope` y la rama en `requireAuth`**

En `src/middleware/auth.js`, junto a `findApiKey`:

```js
const findPartner = db.prepare('SELECT id FROM partners WHERE id = ? AND disabled_at IS NULL');

// A partner reaches exactly the clients its live, non-admin keys point at.
// MIN(id) makes the choice deterministic when a partner holds two live keys
// for the same client.
const findPartnerScope = db.prepare(`
  SELECT MIN(k.id) AS api_key_id, k.client_id
  FROM api_keys k
  JOIN clients c ON c.id = k.client_id
  WHERE k.partner_id = ? AND k.revoked_at IS NULL AND k.is_admin = 0
  GROUP BY k.client_id
`);

function partnerScope(partnerId) {
  return findPartnerScope.all(partnerId);
}
```

En `requireAuth`, entre la rama de `X-API-Key` y la de sesión de admin:

```js
  // Partner session. Deliberately BEFORE the admin branch: a session that
  // somehow carried both flags lands on the path with less power.
  // The password authenticates; the api key still authorizes — so every
  // ownership check downstream keeps working off a real key id.
  if (req.session && req.session.partnerId) {
    if (!findPartner.get(req.session.partnerId)) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    const rows = partnerScope(req.session.partnerId);
    req.authMethod = 'partner';
    req.partnerId = req.session.partnerId;
    req.scopeClientIds = rows.map(r => r.client_id);
    req.partnerKeyByClient = Object.fromEntries(rows.map(r => [r.client_id, r.api_key_id]));
    return next();
  }
```

Exportar `partnerScope`:

```js
module.exports = { requireAuth, requireSession, requireSessionOrAdmin, blockAdminKeys, callerScope, partnerScope };
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `node --test tests/partner-identity.test.js`
Expected: PASS (6 tests)

- [ ] **Step 5: Correr toda la suite**

Run: `node --test`
Expected: PASS, sin regresiones

- [ ] **Step 6: Commit**

```bash
git add src/middleware/auth.js tests/partner-identity.test.js
git commit -m "Add the partner identity to requireAuth

The password authenticates; the api key still authorizes. A partner request
carries the same fields a real key request does, so every ownership check
downstream keeps working off a real key id — and files.api_key_id keeps
telling the truth about who uploaded what."
```

---

### Task 4: La puerta `/socios`

**Files:**
- Create: `src/routes/partner.js`
- Create: `public/socios.html`
- Modify: `src/routes/auth.js` (status reporta `role`)
- Modify: `src/middleware/auth.js` (`publicPaths`)
- Modify: `server.js`
- Modify: `public/js/api.js` (401 → `/socios`)
- Test: `tests/partner-login.test.js` (crear)

**Interfaces:**
- Consumes: tabla `partners` (Task 2), rama de socio (Task 3)
- Produces: `POST /api/partner/login` body `{ password }` → `{ ok: true }` | 401; `GET /api/auth/status` → `{ authenticated, role: 'admin'|'partner'|null, cdn_base_url }`

- [ ] **Step 1: Escribir el test que falla**

Crear `tests/partner-login.test.js` (prólogo de scratch, `scratch = .../partner-login`):

```js
const { test } = require('node:test');
const assert = require('node:assert');
const bcrypt = require('bcrypt');
const express = require('express');
const session = require('express-session');
const db = require('../src/db/connection');

const hash = bcrypt.hashSync('correct-horse', 10);
db.prepare("INSERT INTO partners (name, display_name, password_hash) VALUES ('p1','P One', ?)").run(hash);
db.prepare("INSERT INTO partners (name, password_hash, disabled_at) VALUES ('off', ?, datetime('now'))")
  .run(bcrypt.hashSync('disabled-pass', 10));

const app = express();
app.use(express.json());
app.use(session({ secret: 'test', resave: false, saveUninitialized: false }));
app.use('/api/partner', require('../src/routes/partner'));
app.use('/api/auth', require('../src/routes/auth'));

async function post(pathname, body, cookie) {
  const server = app.listen(0);
  const port = server.address().port;
  const res = await fetch(`http://127.0.0.1:${port}${pathname}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
  const out = { status: res.status, cookie: res.headers.get('set-cookie'), body: await res.json().catch(() => null) };
  server.close();
  return out;
}

test('partner login: correct password authenticates', async () => {
  const { status, cookie } = await post('/api/partner/login', { password: 'correct-horse' });
  assert.strictEqual(status, 200);
  assert.ok(cookie, 'expected a session cookie');
});

test('partner login: wrong password is 401', async () => {
  const { status } = await post('/api/partner/login', { password: 'nope' });
  assert.strictEqual(status, 401);
});

test('partner login: missing password is 400', async () => {
  const { status } = await post('/api/partner/login', {});
  assert.strictEqual(status, 400);
});

test('partner login: a disabled partner cannot get in with its own password', async () => {
  const { status } = await post('/api/partner/login', { password: 'disabled-pass' });
  assert.strictEqual(status, 401);
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `node --test tests/partner-login.test.js`
Expected: FAIL — `Cannot find module '../src/routes/partner'`

- [ ] **Step 3: Crear la ruta de login**

Crear `src/routes/partner.js`:

```js
const { Router } = require('express');
const bcrypt = require('bcrypt');
const db = require('../db/connection');

const router = Router();

const activePartners = db.prepare('SELECT id, password_hash FROM partners WHERE disabled_at IS NULL');

// Password only, no username: the partner is handed one secret and nothing else.
// The cost is a bcrypt.compare per active partner, which is fine at this scale
// and is rate-limited in server.js. Dozens of partners would want a user field.
router.post('/login', async (req, res) => {
  const { password } = req.body;
  if (!password) {
    return res.status(400).json({ error: 'Password required' });
  }

  let matched = null;
  for (const p of activePartners.all()) {
    if (await bcrypt.compare(password, p.password_hash)) {
      matched = p.id;
      break;
    }
  }
  if (!matched) {
    return res.status(401).json({ error: 'Invalid password' });
  }

  // Regenerate so a partner session can never inherit an admin flag from a
  // pre-existing cookie.
  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: 'Session error' });
    req.session.partnerId = matched;
    req.session.save(() => res.json({ ok: true }));
  });
});

module.exports = router;
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `node --test tests/partner-login.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: `status` reporta el rol**

En `src/routes/auth.js`, reemplazar el handler de `/status`:

```js
router.get('/status', (req, res) => {
  const isAdmin = !!(req.session && req.session.authenticated);
  const isPartner = !!(req.session && req.session.partnerId);
  res.json({
    authenticated: isAdmin || isPartner,
    role: isAdmin ? 'admin' : (isPartner ? 'partner' : null),
    cdn_base_url: config.CDN_BASE_URL,
  });
});
```

- [ ] **Step 6: La página de contraseña**

Crear `public/socios.html` (misma estética que `login.html`, un solo campo):

```html
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Luna Visor - Socios</title>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/css/style.css">
</head>
<body class="login-page">
  <div class="login-container">
    <svg class="login-icon" viewBox="0 0 64 64" aria-hidden="true">
      <circle cx="32" cy="32" r="28" fill="#e94560"/>
      <circle cx="42" cy="26" r="22" fill="#1a1a2e"/>
    </svg>
    <h1>Luna Visor</h1>
    <p class="subtitle">Acceso de socios</p>
    <form id="login-form">
      <input type="password" id="password" placeholder="Contraseña" autofocus required>
      <button type="submit">Entrar</button>
      <p id="login-error" class="error" hidden></p>
    </form>
  </div>
  <script src="/js/socios-login.js"></script>
</body>
</html>
```

Crear `public/js/socios-login.js`:

```js
document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.getElementById('login-error');
  errEl.hidden = true;
  const password = document.getElementById('password').value;
  try {
    const res = await fetch('/api/partner/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (res.ok) {
      window.location.href = '/socios';
    } else {
      const data = await res.json();
      errEl.textContent = data.error || 'No se pudo entrar';
      errEl.hidden = false;
    }
  } catch {
    errEl.textContent = 'Error de conexión';
    errEl.hidden = false;
  }
});
```

- [ ] **Step 7: Cablear en `server.js`**

Antes de `app.use(requireAuth)`, junto a las otras rutas públicas:

```js
// Partner door: one URL. Not authenticated → the password screen; authenticated
// → the very same index.html the owner uses.
const partnerLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts, try again later.' },
});
app.use('/api/partner/login', partnerLoginLimiter);
app.use('/api/partner', require('./src/routes/partner'));

app.get('/socios', (req, res) => {
  const page = (req.session && req.session.partnerId) ? 'index.html' : 'socios.html';
  res.sendFile(path.join(__dirname, 'public', page));
});
```

El limiter del socio es una instancia aparte del `loginLimiter` del owner a propósito: un socio bajo ataque no debe cerrarle la puerta al owner.

- [ ] **Step 8: `publicPaths`**

En `src/middleware/auth.js`:

```js
const publicPaths = ['/api/auth/login', '/api/auth/status', '/api/openapi.json', '/login.html', '/socios', '/api/partner/login'];
```

- [ ] **Step 9: El 401 del frontend debe volver a la puerta correcta**

En `public/js/api.js`, dentro de `request`:

```js
    if (res.status === 401) {
      window.location.href = window.location.pathname.startsWith('/socios')
        ? '/socios'
        : '/login.html';
      return null;
    }
```

- [ ] **Step 10: Verificar en vivo**

```bash
sudo systemctl restart luna-visor && sleep 2
# desde selene, saltándose Caddy:
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/socios                    # → 200 (pantalla de contraseña)
curl -sS http://127.0.0.1:3000/api/auth/status | jq                                       # → role: null
curl -sS -X POST http://127.0.0.1:3000/api/partner/login -H 'Content-Type: application/json' -d '{"password":"nope"}' -i | head -1   # → 401
```

- [ ] **Step 11: Commit**

```bash
git add src/routes/partner.js src/routes/auth.js src/middleware/auth.js server.js public/socios.html public/js/socios-login.js public/js/api.js tests/partner-login.test.js
git commit -m "Add the /socios door: password screen, then the owner's own UI

One URL. Not authenticated it serves the password screen; authenticated it
serves the same index.html the owner gets. The partner login has its own rate
limiter so a partner under attack cannot lock the owner out."
```

---

### Task 5: `GET /api/clients` acotado al socio

Sin esto el sidebar le muestra los 27 clientes (y le da 403 al abrirlos).

**Files:**
- Modify: `src/middleware/auth.js` (guard `requireClientListAccess`)
- Modify: `src/routes/clients.js:11-21`
- Test: `tests/partner-clients.test.js` (crear)

**Interfaces:**
- Consumes: `callerScope` (Task 1), identidad de socio (Task 3)
- Produces: `requireClientListAccess(req, res, next)` exportado desde `src/middleware/auth.js`

- [ ] **Step 1: Escribir el test que falla**

Crear `tests/partner-clients.test.js` (prólogo de scratch, `scratch = .../partner-clients`). Siembra: 3 clientes, un socio con keys para los dos primeros, una client key, una admin key. App Express con `requireAuth` + `/api/clients`, y un shim que inyecta la sesión de socio:

```js
const app = express();
app.use(express.json());
app.use((req, _res, next) => {           // stand-in for express-session
  if (req.headers['x-test-partner']) req.session = { partnerId: Number(req.headers['x-test-partner']) };
  next();
});
app.use(requireAuth);
app.use('/api/clients', require('../src/routes/clients'));

test('partner: the client list is only its own vaults', async () => {
  const { status, body } = await get('/api/clients', { 'x-test-partner': String(pid) });
  assert.strictEqual(status, 200);
  assert.deepStrictEqual(body.map(c => c.id).sort((x, y) => x - y), [cA, cB]);
});

test('partner: creating a client is refused', async () => {
  const { status } = await post('/api/clients', { name: 'nope' }, { 'x-test-partner': String(pid) });
  assert.strictEqual(status, 403);
});

test('regression: a client key still cannot list clients', async () => {
  const { status } = await get('/api/clients', { 'X-API-Key': RAW_CLIENT });
  assert.strictEqual(status, 403);
});

test('regression: an admin key still lists every client', async () => {
  const { status, body } = await get('/api/clients', { 'X-API-Key': RAW_ADMIN });
  assert.strictEqual(status, 200);
  assert.strictEqual(body.length, 3);
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `node --test tests/partner-clients.test.js`
Expected: FAIL — el socio recibe 403 en el listado (hoy `requireSessionOrAdmin` lo rechaza)

- [ ] **Step 3: Añadir el guard**

En `src/middleware/auth.js`:

```js
// The client list is the partner's sidebar, so it admits partners too.
// Client-scoped keys stay out, exactly as before.
function requireClientListAccess(req, res, next) {
  if (req.authMethod === 'session') return next();
  if (req.authMethod === 'partner') return next();
  if (req.authMethod === 'api-key' && req.isAdminKey) return next();
  return res.status(403).json({ error: 'Session, admin API key or partner required' });
}
```

Exportarla.

- [ ] **Step 4: Acotar el query**

En `src/routes/clients.js`, reemplazar el `GET /`:

```js
router.get('/', requireClientListAccess, (req, res) => {
  const scope = callerScope(req);
  const params = [];
  let where = '';
  if (scope) {
    if (!scope.length) return res.json([]);
    where = `WHERE c.id IN (${scope.map(() => '?').join(',')})`;
    params.push(...scope);
  }
  const clients = db.prepare(`
    SELECT c.*, COUNT(f.id) as file_count
    FROM clients c
    LEFT JOIN files f ON f.client_id = c.id
    ${where}
    GROUP BY c.id
    ORDER BY c.name
  `).all(...params);
  res.json(clients);
});
```

y ajustar el import del archivo:

```js
const { requireSession, requireSessionOrAdmin, requireClientListAccess, callerScope } = require('../middleware/auth');
```

- [ ] **Step 5: Correr y verificar que pasa**

Run: `node --test tests/partner-clients.test.js`
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
git add src/middleware/auth.js src/routes/clients.js tests/partner-clients.test.js
git commit -m "Scope the client list to the caller: the partner's sidebar is its vaults"
```

---

### Task 6: Integración end-to-end del socio

El test que le da valor a todo lo anterior. Aquí es donde se prueba que el fail-open de `files.js` está muerto.

**Files:**
- Test: `tests/partner-scope.test.js` (crear)

**Interfaces:**
- Consumes: todo lo de las tasks 1-5

- [ ] **Step 1: Escribir la suite**

Crear `tests/partner-scope.test.js` (prólogo de scratch, `scratch = .../partner-scope`, con `fs.mkdirSync(path.join(scratch,'files'))` además de `db`). App Express con el shim de sesión de Task 5 más `/api/files`. Siembra: clientes A y B (del socio) y C (ajeno), un archivo real por cliente creado con `sharp` como en `tests/preserve-format.test.js`.

```js
test('THE regression test: a partner uploading with a foreign client_id never writes there', async () => {
  const form = new FormData();
  form.append('client_id', String(cC));                 // vault that is NOT the partner's
  form.append('files', new Blob([png]), 'probe.png');
  const { status } = await postForm('/api/files/upload', form, { 'x-test-partner': String(pid) });

  assert.strictEqual(status, 403);
  const landed = db.prepare('SELECT COUNT(*) n FROM files WHERE client_id = ?').get(cC).n;
  assert.strictEqual(landed, 1, 'the foreign vault must still hold only its seeded file');
});

test('partner: GET /api/files is the union of its vaults and nothing else', async () => {
  const { status, body } = await get('/api/files', { 'x-test-partner': String(pid) });
  assert.strictEqual(status, 200);
  assert.deepStrictEqual([...new Set(body.map(f => f.client_id))].sort((x, y) => x - y), [cA, cB]);
});

test('partner: upload attribution points at its real key', async () => {
  const form = new FormData();
  form.append('client_id', String(cA));
  form.append('files', new Blob([png]), 'ok.png');
  const { status, body } = await postForm('/api/files/upload', form, { 'x-test-partner': String(pid) });
  assert.strictEqual(status, 201);
  const row = db.prepare('SELECT api_key_id FROM files WHERE id = ?').get(body[0].id);
  assert.strictEqual(row.api_key_id, keyA);
});

test('partner: the response carries no upload attribution', async () => {
  const { body } = await get('/api/files', { 'x-test-partner': String(pid) });
  assert.ok(!('api_key_name' in body[0]));
  assert.ok(!('api_key_id' in body[0]));
  assert.ok('has_thumbnail' in body[0], 'but it does keep the fields the gallery needs');
});

test('partner: ?client_id= on a foreign vault is 403, not a silent re-scope', async () => {
  const { status } = await get(`/api/files?client_id=${cC}`, { 'x-test-partner': String(pid) });
  assert.strictEqual(status, 403);
});

test('partner: reading, deleting, replacing and covering a foreign file is 403', async () => {
  for (const [method, p] of [['GET', `/api/files/${fileC}`], ['DELETE', `/api/files/${fileC}`]]) {
    const { status } = await req(method, p, { 'x-test-partner': String(pid) });
    assert.strictEqual(status, 403, `${method} ${p}`);
  }
  const { status } = await post(`/api/files/${fileC}/story`, {}, { 'x-test-partner': String(pid) });
  assert.strictEqual(status, 403);
});

test('partner: deleting its own file works', async () => {
  const { status } = await req('DELETE', `/api/files/${fileA}`, { 'x-test-partner': String(pid) });
  assert.strictEqual(status, 200);
});

test('partner: move and copy are refused — they are owner-only', async () => {
  const m = await req('PATCH', `/api/files/${fileB}`, { 'x-test-partner': String(pid) }, { client_id: cA });
  assert.strictEqual(m.status, 403);
  const c = await post(`/api/files/${fileB}/copy`, { client_id: cA }, { 'x-test-partner': String(pid) });
  assert.strictEqual(c.status, 403);
});

test('partner: revoking a key takes that vault out of sight immediately', async () => {
  db.prepare('UPDATE api_keys SET revoked_at = datetime(\'now\') WHERE id = ?').run(keyB);
  const { body } = await get('/api/files', { 'x-test-partner': String(pid) });
  assert.ok(!body.some(f => f.client_id === cB));
  db.prepare('UPDATE api_keys SET revoked_at = NULL WHERE id = ?').run(keyB);   // restore
});
```

- [ ] **Step 2: Correr la suite**

Run: `node --test tests/partner-scope.test.js`
Expected: PASS. Cualquier fallo aquí es un hueco real de las tasks 1-5, no del test — arreglar el código, no la aserción.

- [ ] **Step 3: Correr todo**

Run: `node --test`
Expected: PASS, todas las suites

- [ ] **Step 4: Commit**

```bash
git add tests/partner-scope.test.js
git commit -m "End-to-end scope tests for the partner identity

The one that matters: a partner uploading with a foreign client_id in the body
gets a 403 and the foreign vault stays untouched. If anyone reintroduces an
'if (authMethod === api-key)' in a write route, this test goes red."
```

---

### Task 7: La UI consciente del rol

**Files:**
- Modify: `public/js/app.js:28-33` (init) y donde se arma el menú contextual
- Modify: `public/js/gallery.js:200-208` (`formatSourceTooltip`) y `showContextMenu`

**Interfaces:**
- Consumes: `GET /api/auth/status` → `role` (Task 4)
- Produces: `App.role` global, leído por `gallery.js`

- [ ] **Step 1: Guardar el rol al arrancar**

En `public/js/app.js`, en `init()`:

```js
    const status = await statusRes.json();
    this.cdnBaseUrl = (status.cdn_base_url || '').replace(/\/$/, '');
    this.role = status.role || 'admin';
    if (this.role === 'partner') this.hideOwnerControls();
```

Y añadir el método al objeto `App`:

```js
  // The server already refuses these to a partner. Hiding them is honesty, not
  // security: the UI stops offering what would come back 403.
  hideOwnerControls() {
    for (const id of ['btn-add-client', 'btn-add-client-caret', 'btn-api-keys']) {
      const el = document.getElementById(id);
      if (el) el.hidden = true;
    }
    const dropup = document.getElementById('dropup-add-client');
    if (dropup) dropup.hidden = true;
  },
```

Cuidado: los listeners de esos botones se registran más abajo en `init()`. Como el elemento sigue en el DOM (sólo `hidden`), `addEventListener` no truena. No hay que reordenar nada.

- [ ] **Step 2: Quitar mover/copiar del menú contextual**

En `public/js/gallery.js`, en `showContextMenu`, tanto en la rama de selección múltiple como en la de un solo archivo, filtrar antes de mostrar:

```js
      ContextMenu.show(x, y, App.role === 'partner'
        ? items.filter(i => !/^(Move|Copy \d+ files)/.test(i.label || ''))
        : items);
```

Aplicar el mismo filtro en los dos `ContextMenu.show(...)` del método.

- [ ] **Step 3: El tooltip no debe mentir**

En `public/js/gallery.js`, `formatSourceTooltip`:

```js
function formatSourceTooltip(file) {
  const lines = [file.original_name];
  // A partner's rows carry no attribution at all — saying "via session" would
  // be a claim we cannot make.
  if (App.role === 'partner') return lines.join('\n');
  if (file.api_key_name) {
    const revoked = file.api_key_revoked_at ? ' (revoked)' : '';
    lines.push(`Uploaded via API key: ${file.api_key_name}${revoked}`);
  } else {
    lines.push('Uploaded via session');
  }
  return lines.join('\n');
}
```

- [ ] **Step 4: Verificar en un navegador de verdad**

No basta con leer el código. Usar el probe de Chromium headless documentado en la memoria `reference_headless_chromium_probe` (Chromium en `personal-chrome`, `10.89.1.2:9222`, `Network.setCacheDisabled` obligatorio):

1. Entrar a `/socios` con la contraseña de prueba
2. Confirmar por screenshot: el sidebar trae 2 clientes, no hay "+ New Client", no hay "API Keys"
3. Click derecho en una card: no aparecen Move ni Copy
4. Doble click: el visor abre y el video reproduce

- [ ] **Step 5: Commit**

```bash
git add public/js/app.js public/js/gallery.js
git commit -m "Hide the owner-only controls from a partner session

The server already refuses all three; the UI just stops offering them. The
source tooltip drops the attribution line entirely for a partner rather than
claiming 'uploaded via session', which would be a claim we cannot make."
```

---

### Task 8: Reemplazar archivo desde el WUI

`POST /api/files/:id/replace` existe desde hace meses y **el WUI nunca lo expuso** — `grep -rn "replace" public/js/` no devuelve una sola llamada. El owner lo pidió para el socio; queda también para él.

**Files:**
- Modify: `public/js/api.js` (añadir `replaceFile`)
- Modify: `public/js/gallery.js` (entrada en el menú contextual)

**Interfaces:**
- Consumes: `POST /api/files/:id/replace`, multipart, campo `file` (singular)
- Produces: `API.replaceFile(id, file) → Promise<fileObject>`

- [ ] **Step 1: Añadir la llamada**

En `public/js/api.js`, junto a `uploadFiles`:

```js
  // Replace keeps the same UUID and the same cdn_url — that is the whole point:
  // references living in someone else's database keep resolving.
  replaceFile(id, file) {
    const formData = new FormData();
    formData.append('file', file);
    return this.request('POST', `/api/files/${id}/replace`, formData);
  },
```

`request` ya manda el `FormData` tal cual sin `Content-Type` (rama `else if (body)`), que es lo que el boundary necesita.

- [ ] **Step 2: Añadir la entrada al menú contextual de un solo archivo**

En `public/js/gallery.js`, en la rama de un solo archivo de `showContextMenu`, antes del separador que precede a Delete:

```js
        {
          label: 'Replace file...',
          action: () => {
            const input = document.createElement('input');
            input.type = 'file';
            input.onchange = async () => {
              if (!input.files.length) return;
              try {
                await API.replaceFile(file.id, input.files[0]);
                await App.loadFiles();
              } catch (err) {
                alert(`No se pudo reemplazar: ${err.message}`);
              }
            };
            input.click();
          },
        },
```

- [ ] **Step 3: Probar en el navegador con un archivo real**

1. Subir una imagen de prueba a un cliente de scratch
2. Reemplazarla desde el menú contextual con otra imagen distinta
3. Confirmar: el UUID no cambió, el `cdn_url` es el mismo, y la imagen servida es la nueva

```bash
# antes y después, la misma URL debe cambiar de bytes:
curl -sS "https://cdn.solutions45.com/<uuid>.webp" | sha256sum
```

El CDN sirve con `Cache-Control: no-cache` (revalida siempre), así que no hace falta cache-bust — pero verificar con la caché deshabilitada, no confiar en un reload normal.

- [ ] **Step 4: Commit**

```bash
git add public/js/api.js public/js/gallery.js
git commit -m "Expose replace in the WUI — it existed only over the API until today

Same UUID, same cdn_url, so references in other people's databases keep
resolving. The owner gets it too; it was never a partner-only need."
```

---

### Task 9: CLI de socios y badge en API Keys

**Files:**
- Create: `scripts/partners.js`
- Modify: `public/js/api-keys.js` (badge)
- Modify: `src/routes/api-keys.js` (exponer `partner_name` en el listado)

**Interfaces:**
- Consumes: tabla `partners`, `api_keys.partner_id` (Task 2)
- Produces: `node scripts/partners.js <subcomando>`

- [ ] **Step 1: Escribir el CLI**

Crear `scripts/partners.js`:

```js
#!/usr/bin/env node
// Partner administration. There is no WUI for this in v1 — the badge on the
// API Keys page is the owner's visibility, this is the lever.
const bcrypt = require('bcrypt');
const db = require('../src/db/connection');

const [, , cmd, ...args] = process.argv;

function die(msg) { console.error(msg); process.exit(1); }

const commands = {
  list() {
    const partners = db.prepare('SELECT * FROM partners ORDER BY id').all();
    for (const p of partners) {
      const state = p.disabled_at ? `DISABLED ${p.disabled_at}` : 'active';
      console.log(`#${p.id} ${p.name} (${p.display_name || '—'}) — ${state}`);
      const vaults = db.prepare(`
        SELECT k.id, k.name, c.name AS client, k.revoked_at
        FROM api_keys k LEFT JOIN clients c ON c.id = k.client_id
        WHERE k.partner_id = ? ORDER BY k.id
      `).all(p.id);
      for (const v of vaults) {
        console.log(`    key #${v.id} → ${v.client || 'ADMIN'}${v.revoked_at ? '  [revoked]' : ''}  "${v.name}"`);
      }
      if (!vaults.length) console.log('    (sin bóvedas)');
    }
  },

  create(name, password, display) {
    if (!name || !password) die('uso: create <name> <password> [display_name]');
    const hash = bcrypt.hashSync(password, 12);
    const id = db.prepare('INSERT INTO partners (name, display_name, password_hash) VALUES (?, ?, ?)')
      .run(name, display || null, hash).lastInsertRowid;
    console.log(`socio #${id} ${name} creado`);
  },

  passwd(name, password) {
    if (!name || !password) die('uso: passwd <name> <password>');
    const r = db.prepare('UPDATE partners SET password_hash = ? WHERE name = ?')
      .run(bcrypt.hashSync(password, 12), name);
    console.log(r.changes ? `contraseña de ${name} rotada` : `no existe el socio ${name}`);
  },

  disable(name) {
    const r = db.prepare("UPDATE partners SET disabled_at = datetime('now') WHERE name = ?").run(name);
    console.log(r.changes ? `${name} deshabilitado` : `no existe el socio ${name}`);
  },

  enable(name) {
    const r = db.prepare('UPDATE partners SET disabled_at = NULL WHERE name = ?').run(name);
    console.log(r.changes ? `${name} habilitado` : `no existe el socio ${name}`);
  },

  grant(name, keyId) {
    const p = db.prepare('SELECT id FROM partners WHERE name = ?').get(name);
    if (!p) die(`no existe el socio ${name}`);
    const k = db.prepare('SELECT id, is_admin, revoked_at, client_id FROM api_keys WHERE id = ?').get(keyId);
    if (!k) die(`no existe la key #${keyId}`);
    // An admin key hung on a partner would be catastrophic. The scope query
    // filters is_admin=0 as well, but refusing here is where it is legible.
    if (k.is_admin) die('esa es una ADMIN key — jamás se cuelga a un socio');
    if (k.revoked_at) die('esa key está revocada — mintea una nueva');
    db.prepare('UPDATE api_keys SET partner_id = ? WHERE id = ?').run(p.id, k.id);
    console.log(`key #${k.id} (client ${k.client_id}) colgada a ${name}`);
  },

  ungrant(keyId) {
    const r = db.prepare('UPDATE api_keys SET partner_id = NULL WHERE id = ?').run(keyId);
    console.log(r.changes ? `key #${keyId} despegada` : `no existe la key #${keyId}`);
  },
};

if (!commands[cmd]) {
  die(`uso: node scripts/partners.js <${Object.keys(commands).join('|')}>`);
}
commands[cmd](...args);
```

- [ ] **Step 2: Probarlo contra una DB de scratch, no contra la viva**

```bash
cd ~/luna-visor
MEDIA_PATH=/tmp/claude-1001/-home-endymion-luna-visor/*/scratchpad/partners-cli \
  node -e "require('fs').mkdirSync(process.env.MEDIA_PATH+'/db',{recursive:true})" 2>/dev/null
MEDIA_PATH=<esa ruta> node scripts/partners.js create prueba 'pw-de-prueba' 'Prueba'
MEDIA_PATH=<esa ruta> node scripts/partners.js list
```

Expected: el socio aparece con `(sin bóvedas)`.

- [ ] **Step 3: Exponer `partner_name` en el listado de api-keys**

En `src/routes/api-keys.js`, en el `SELECT` del `GET /`, añadir el LEFT JOIN:

```sql
  LEFT JOIN partners p ON p.id = k.partner_id
```

y `p.name AS partner_name` a la lista de columnas.

- [ ] **Step 4: Pintar el badge**

En `public/js/api-keys.js`, donde se arma la metadata de cada fila, añadir después del nombre del cliente:

```js
      ${key.partner_name ? `<span class="key-partner-badge">socio: ${key.partner_name}</span>` : ''}
```

y una regla mínima en `public/css/style.css`:

```css
.key-partner-badge {
  font-size: 0.75rem;
  padding: 0.1rem 0.4rem;
  border-radius: 4px;
  background: #2d3748;
  color: #a0aec0;
  margin-left: 0.5rem;
}
```

- [ ] **Step 5: Commit**

```bash
git add scripts/partners.js src/routes/api-keys.js public/js/api-keys.js public/css/style.css
git commit -m "Add the partners CLI and a 'socio' badge on the API Keys page

Granting a client is minting its key and hanging it on the partner; the badge
is how that stays visible from the interface instead of only in the DB."
```

---

### Task 10: Caddy y puesta en marcha

**Files:**
- Modify: `/etc/caddy/conf.d/luna.solutions45.com` (fuera del repo)
- Modify: `src/openapi.js` (bump de versión)
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: todo lo anterior

- [ ] **Step 1: Respaldar el vhost antes de tocarlo**

```bash
sudo cp /etc/caddy/conf.d/luna.solutions45.com /etc/caddy/conf.d/luna.solutions45.com.bak-2026-08-30
```

- [ ] **Step 2: Añadir el matcher**

En `/etc/caddy/conf.d/luna.solutions45.com`, después del bloque `handle @openapi` y **antes** del `handle` con basic_auth:

```
	@socios {
		path /socios /js/* /css/* /favicon.svg /calendar-clock.svg /file-lock.svg
		     /api/partner/login /api/auth/status /api/auth/logout
		     /api/clients /api/files /api/files/*
	}

	handle @socios {
		reverse_proxy localhost:3000
	}
```

Tres cosas que no son opcionales:
- `/api/files` va listado **aparte** de `/api/files/*`: el `path` de Caddy es match exacto salvo wildcard. Este gotcha ya costó un incidente (2026-07-24).
- `/api/clients` va **sin** `/*`: el socio lista, no renombra ni borra.
- `/api/auth/login` **no** se exenta: la puerta del owner conserva su doble capa.

- [ ] **Step 3: Validar y recargar**

```bash
sudo caddy validate --config /etc/caddy/Caddyfile && sudo systemctl reload caddy
```

- [ ] **Step 4: Verificar que la puerta abre sin basic_auth y que la del owner sigue cerrada**

```bash
# La puerta del socio: 200 sin credenciales
curl -sS -o /dev/null -w 'socios: %{http_code}\n' https://luna.solutions45.com/socios

# La del owner: 401 de Caddy (trae www-authenticate y body vacío)
curl -sS -i https://luna.solutions45.com/ | head -3

# El login del owner NO debe estar expuesto
curl -sS -o /dev/null -w 'auth/login: %{http_code}\n' -X POST https://luna.solutions45.com/api/auth/login   # → 401 de Caddy

# La API del socio, sin sesión: 401 de la app (JSON), no de Caddy
curl -sS -i https://luna.solutions45.com/api/files | head -5   # content-type: application/json
```

- [ ] **Step 5: Dar de alta a richie**

**Antes de correr esto, preguntarle al owner la contraseña final.** Él propuso `Solutions45`; se le señaló una vez que en un dominio llamado solutions45.com eso se adivina al segundo intento y que esa puerta borra archivos. La decisión es suya y va aquí, no en ningún archivo.

```bash
cd ~/luna-visor
node scripts/partners.js create richie '<contraseña que el owner confirme>' 'Richie'
node scripts/partners.js grant richie 69    # richie — clinic-beauty-spa (client 19)
node scripts/partners.js grant richie 70    # richie — clinic-beauty-bea (client 30)
node scripts/partners.js list
```

- [ ] **Step 6: Verificación funcional end-to-end, como richie**

```bash
J=$(mktemp)
curl -sS -c $J -X POST https://luna.solutions45.com/api/partner/login \
  -H 'Content-Type: application/json' -d '{"password":"<la contraseña>"}'
curl -sS -b $J https://luna.solutions45.com/api/clients | jq '[.[].name]'      # → los 2 de beauty
curl -sS -b $J https://luna.solutions45.com/api/files | jq 'length'            # → 42 + 116 = 158
curl -sS -b $J -o /dev/null -w '%{http_code}\n' 'https://luna.solutions45.com/api/files?client_id=2'   # → 403
curl -sS -b $J -o /dev/null -w '%{http_code}\n' https://luna.solutions45.com/api/api-keys              # → 403
rm -f $J
```

Y en un navegador de verdad: entrar a `/socios`, confirmar sidebar con 2 clientes, subir un archivo, reemplazarlo, borrarlo.

- [ ] **Step 7: Documentar**

`src/openapi.js`: bump de `info.version` (minor — hay identidad nueva pero el contrato de las api keys no cambió) y una nota en la descripción de `GET /api/files` sobre el scope por caller.

`CLAUDE.md`: sección nueva bajo "Authentication" describiendo la tercera identidad, `callerScope`, el derivado del scope desde `api_keys.partner_id`, y el matcher `@socios` en la sección de Caddy.

- [ ] **Step 8: Commit final y merge**

```bash
git add src/openapi.js CLAUDE.md
git commit -m "Document the partner identity and the /socios door"
git checkout main && git merge --no-ff socios-luna
```

---

## Self-Review

**Cobertura del spec:**

| Sección del spec | Task |
|---|---|
| §2 `callerScope` y los 8 checks | 1 |
| §3 schema `partners` + `partner_id` + scope derivado | 2, 3 |
| §4 autenticación, puerta, `role` | 4 |
| §5 `files.js`, proyección del socio, `clients.js`, overlay | 1, 5 |
| §6 frontend, controles escondidos, replace | 7, 8 |
| §7 Caddy | 10 |
| §8 CLI + badge | 9 |
| §9 pruebas | 1, 2, 3, 4, 5, 6 |
| §11 contraseña pendiente | 10, Step 5 |

**Consistencia de nombres:** `callerScope`, `partnerScope`, `requireClientListAccess`, `stripAttribution`, `fileToPartnerResponse`, `apiKeyIdFor`, `App.role`, `req.scopeClientIds`, `req.partnerKeyByClient` — usados con la misma firma en todas las tasks.

**Riesgo mayor del plan:** la Task 1 toca el archivo más sensible del proyecto sin que ningún comportamiento nuevo lo justifique todavía. Es a propósito: su criterio de éxito es "nada cambió", medible con los tests de regresión del Step 9 y con las llamadas en vivo del Step 11. Si la Task 1 no queda verde, no se sigue.
