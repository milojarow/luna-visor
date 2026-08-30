# Socios en luna — acceso acotado al WUI

**Fecha:** 2026-08-30
**Estado:** diseño aprobado, pendiente de implementar
**Caso que lo origina:** richie (socio, uid 1004 en selene, grupo `socios`) necesita trabajar
las bóvedas `clinic-beauty-spa` (client_id 19) y `clinic-beauty-bea` (client_id 30) desde la
interfaz gráfica de luna, sin ver los otros 25 clientes y sin toparse con el basic_auth de Caddy.

---

## 1. Qué se construye

Una tercera identidad — **socio** — que entra por `luna.solutions45.com/socios` con una sola
contraseña y, ya adentro, usa **el mismo `index.html` y el mismo JavaScript que el owner**.
La diferencia no está en la interfaz: está en que el servidor le contesta sólo sus bóvedas.

Lo que NO se construye: una galería nueva, un selector de bóvedas, una API paralela, ni una
página con su propio diseño. El owner fue explícito: "que vea la interfaz igual como yo la veo".

## 2. El problema real que hay que resolver primero

`src/routes/files.js` tiene **ocho** puntos que preguntan `if (req.authMethod === 'api-key')` y
tratan cualquier otra cosa como dueño de todo:

| Línea | Qué hace hoy si el caller NO es api-key |
|---|---|
| 168 | `client_id = req.body.client_id` → sube a cualquier client |
| 215-221 | se salta el ownership check del replace |
| 252 | se salta el ownership check de covers |
| 290-293 | se salta el ownership check del delete |

Una sesión de socio soltada ahí escribe en las 27 bóvedas. El guard está escrito por **método de
autenticación**, no por **alcance**, y por eso no compone con una identidad nueva.

**El cambio de fondo del proyecto es colapsar esos ocho checks en uno solo.**

### `callerScope(req) → null | number[]`

Vive en `src/middleware/auth.js`. Devuelve *a qué client_ids alcanza quien llama*:

| Caller | Devuelve |
|---|---|
| sesión de owner | `null` (sin restricción) |
| admin key | `null` (lectura sin restricción; las escrituras ya las corta la barrera `blockAdminKeys`) |
| client key | `[req.apiKeyClientId]` |
| socio | `req.scopeClientIds` |
| desconocido | `[]` (fail-closed) |

El default `[]` es deliberado: una identidad futura que nadie enseñó a `callerScope` no ve nada,
en vez de verlo todo. Es la misma disciplina fail-closed que la barrera `blockAdminKeys`.

Con eso, cada uno de los ocho puntos queda de una sola forma:

```js
const scope = callerScope(req);
if (scope && !scope.includes(file.client_id)) return res.status(403).json({ error: 'Access denied' });
```

## 3. Modelo de datos

### Tabla nueva `partners` (en `src/db/schema.sql`)

```sql
CREATE TABLE IF NOT EXISTS partners (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL UNIQUE,
  display_name  TEXT,
  password_hash TEXT NOT NULL,
  created_at    TEXT DEFAULT (datetime('now')),
  disabled_at   TEXT
);
```

`disabled_at` es soft-disable, espejo de `api_keys.revoked_at`.

### Columna nueva `api_keys.partner_id`

Nullable, vía el patrón try/catch `ALTER TABLE` que ya usa `connection.js` (líneas 17-48).
**No** se reconstruye la tabla para meter un CHECK: el rebuild de `api_keys` en vivo es la parte
más riesgosa del cambio, y el invariante que protegería (`no colgar una admin key a un socio`)
ya lo niegan el `WHERE k.is_admin = 0` del query de scope y la validación del CLI.

### El scope NO se almacena — se deriva

```sql
SELECT MIN(k.id) AS api_key_id, k.client_id
FROM api_keys k
JOIN clients c ON c.id = k.client_id
WHERE k.partner_id = ? AND k.revoked_at IS NULL AND k.is_admin = 0
GROUP BY k.client_id
```

**Ésta es la decisión de diseño que más valor da.** El alcance del socio es el de sus api keys,
así que:

- Darle un cliente nuevo = mintear una key para ese cliente y colgársela. Aparece en su sidebar.
- Quitárselo = revocar la key desde el WUI. Desaparece en el mismo acto.

Una palanca, no dos que se desincronizan. Y la atribución sigue siendo real: cuando el socio
sube algo, `files.api_key_id` guarda **su key de verdad** para esa bóveda, así que en la galería
del owner sigue apareciendo quién lo subió.

`MIN(k.id)` resuelve el caso de dos keys activas del mismo socio para el mismo cliente:
se elige una determinísticamente.

## 4. Autenticación

### La puerta

`GET /socios` (público en Express, exento de basic_auth en Caddy):
- sin `req.session.partnerId` → sirve `public/socios.html` (formulario de contraseña, nada más)
- con `req.session.partnerId` → sirve `public/index.html`, el mismo del owner

Una sola URL, contiene "luna" por el host. Es el link que se le manda al socio.

### `POST /api/partner/login`

Body `{ password }`. Sin campo de usuario — el socio sólo se sabe una contraseña.
Recorre los partners activos (`disabled_at IS NULL`) haciendo `bcrypt.compare`. Al primer match:
`req.session.regenerate()` y luego `req.session.partnerId = id`.

`regenerate()` es obligatorio: evita fijación de sesión y garantiza que una sesión de socio nunca
arrastre un `authenticated` de admin.

Rate limit propio (10 intentos / 15 min por IP), instancia aparte del `loginLimiter` del owner
para que un socio bajo ataque no bloquee la puerta del owner.

> El costo de que la contraseña sea sólo-contraseña: `bcrypt.compare` por cada partner activo.
> Con N ≤ 5 es despreciable y está rate-limited. Si algún día hay decenas de socios, esto pide
> un campo de usuario.

### Logout y status

Se **reusan** los del owner: `POST /api/auth/logout` (destruye la sesión igual) y
`GET /api/auth/status`, que se extiende para reportar `role: 'admin' | 'partner'` junto al
`cdn_base_url` que ya devuelve. No hace falta `/api/partner/status`.

### La rama en `requireAuth`

Orden dentro de `src/middleware/auth.js`:

```
1. publicPaths                → pasa
2. header X-API-Key           → auth por key            (sin tocar)
3. session.partnerId          → IDENTIDAD DE SOCIO       ← NUEVO
4. session.authenticated      → sesión admin            (sin tocar)
5. nada                       → 401 / redirect
```

La rama 3 setea:

```js
req.authMethod        = 'partner';
req.partnerId         = req.session.partnerId;
req.scopeClientIds    = [19, 30];              // derivado del query de §3
req.partnerKeyByClient = { 19: 69, 30: 70 };   // para la atribución en saveFile
```

Socio **antes** que admin a propósito: una cookie manipulada que traiga ambos flags cae en el
camino de menos poder.

Si el socio no tiene ninguna key activa, `scopeClientIds` queda vacío y toda ruta scoped le da
403 — no un 500, no acceso total.

`publicPaths` suma `/socios` y `/api/partner/login`.

## 5. Rutas afectadas

### `src/routes/files.js`

Los ocho puntos pasan a `callerScope`. Detalles que no son mecánicos:

- **`GET /`** — con scope no-nulo: `WHERE client_id IN (...)`. Un `?client_id=` fuera del scope
  sigue dando **403**, nunca un re-scope silencioso (invariante ya establecido en el proyecto).
- **`POST /upload`** — sin cambio de contrato para nadie. La forma que lo logra:

  ```js
  const scope = callerScope(req);           // null | number[]
  let client_id;
  if (scope === null)            client_id = req.body.client_id;          // sesión: como hoy
  else if (scope.length === 1)   client_id = scope[0];                    // client key: body ignorado, como hoy
  else {                                                                   // socio con varias bóvedas
    client_id = Number(req.body.client_id);
    if (!scope.includes(client_id)) return res.status(403).json({ error: 'Access denied' });
  }
  ```

  Verificado el 2026-08-30 contra el único consumidor conocido: `video-forge/src/services/cdn.py`
  manda sólo `files=`, sin `client_id`. Y con esta forma daría igual — la rama de client key
  sigue ignorando el body exactamente como hoy.

- **Atribución** — `saveFile(..., api_key_id)` recibe `req.partnerKeyByClient[client_id]` cuando
  el caller es socio, en vez de `null`.

### Proyección de respuesta para el socio

El socio necesita la fila **completa** (la galería del owner usa `has_thumbnail`, `has_resized`,
`referenced`, `client_is_ephemeral`…), pero **no** la atribución interna
(`api_key_id` / `api_key_name` / `api_key_revoked_at`), que expone nombres de herramientas
internas.

`fileToPartnerResponse` = `fileToResponse` menos esos tres campos.

`gallery.js:202` ya guarda con `if (file.api_key_name)`, así que no truena — pero cae al texto
"Uploaded via session", que sería mentira. Se ajusta `formatSourceTooltip` para **omitir la línea**
cuando el rol es socio, en vez de afirmar algo falso.

### `src/routes/clients.js`

`GET /` cambia de `requireSessionOrAdmin` a un guard nuevo `requireClientListAccess`
(sesión, admin key **o** socio; las client keys siguen recibiendo 403, como hoy), y filtra
`WHERE c.id IN (scope)` cuando el scope no es nulo. El resto de las rutas (POST/PATCH/DELETE) no
se tocan: al socio ya le dan 403.

### Lo que el socio no puede tocar, sin escribir una línea nueva

- `PATCH /files/:id` (mover), `POST /files/:id/copy`, `POST /files/scan-references` →
  `requireSession` los rechaza.
- `/api/api-keys/*` y `POST /api/clients` → `requireSessionOrAdmin` los rechaza.

### `src/routes/overlay.js` — hueco encontrado en la auto-revisión

`/api/overlay/generate` deriva su `client_id` de `req.apiKeyClientId` **o del body**. Un socio
tiene `apiKeyClientId` indefinido, así que caería al body sin validar: podría renderizar un
overlay con el branding de cualquier cliente. No escribe nada (devuelve un PNG en la respuesta,
no lo guarda) y Caddy no lo expone al socio, pero **es exactamente la misma clase de fail-open
que este proyecto existe para cerrar**, y confiar sólo en el matcher de Caddy es confiar en una
capa que no es la que decide.

Se cierra en Express: el handler valida el `client_id` resuelto contra `callerScope(req)` y
devuelve 403 si queda fuera. Aplica igual a socios y a client keys que manden un body ajeno.

## 6. Frontend

**Mismo `index.html`, mismo `gallery.js`, mismo `lightbox.js`, mismo `upload.js`.**

- `app.js` — al arrancar lee `role` de `/api/auth/status`. Si es `partner`, esconde
  `#btn-add-client`, `#btn-add-client-caret`, `#dropup-add-client`, `#btn-api-keys`, y omite
  mover/copiar del menú contextual. Son exactamente los controles que el servidor ya le niega:
  la UI deja de mentirle, no lo protege.
- `api.js` — el handler de 401 hoy manda a `/login.html` siempre. Pasa a mandar a `/socios`
  cuando `location.pathname` empieza con `/socios`.
- `public/socios.html` — formulario de contraseña, un campo. Reusa `/css/style.css` y la clase
  `.login-page` que ya existe.

### Reemplazar archivo (feature nueva para todos)

`POST /api/files/:id/replace` existe en el backend desde hace meses pero **el WUI nunca lo
expuso** — `grep -rn "replace" public/js/` no devuelve una sola llamada. El owner lo pidió para
el socio, así que se construye y queda también para el owner:

- `API.replaceFile(id, file)` en `api.js` (multipart, campo `file` singular)
- Entrada "Replace…" en el menú contextual de una card → file picker → progreso → refresca la card
- El UUID y el `cdn_url` no cambian. Como el CDN sirve con `no-cache` (revalidación siempre),
  no hace falta cache-bust.

## 7. Caddy

Un matcher nuevo en `/etc/caddy/conf.d/luna.solutions45.com`, colocado **antes** del `handle`
con basic_auth y después de `@api_key` / `@openapi`:

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

Notas:

- **`path` de Caddy es match exacto salvo wildcard.** `/api/files/*` NO cubre `/api/files`;
  por eso van los dos. Este gotcha ya costó un incidente en este proyecto (2026-07-24).
- `/api/clients` va **sin** `/*`: el socio lista, no renombra ni borra.
- `/api/auth/login` NO se exenta — la puerta del owner conserva su doble capa.
- Una petición anónima a estos paths llega a Express y cobra 401 JSON. Misma postura que
  `@openapi` y que `@api_key` con una key basura. No degrada nada.

**Costo aceptado explícitamente por el owner:** exentar `/js/*` y `/css/*` deja el JavaScript
del WUI legible desde internet. No hay secretos ahí — sólo llamadas a una API que sigue
guardada — pero deja de ser invisible.

## 8. Alta y baja (operación del owner)

CLI `scripts/partners.js`, sin UI en v1:

| Comando | Qué hace |
|---|---|
| `list` | socios, estado, y las bóvedas que alcanza cada uno |
| `create <name> [--display X]` | crea el socio y fija su contraseña (bcrypt) |
| `passwd <name>` | rota la contraseña |
| `disable <name>` / `enable <name>` | soft-disable |
| `grant <name> <api_key_id>` | cuelga una key al socio. **Rechaza admin keys** y keys revocadas |
| `ungrant <api_key_id>` | despega la key (no la revoca) |

Además, un badge `socio: <name>` en la página de API Keys del WUI, para que el owner vea de un
vistazo qué keys alcanzan un socio. Sin eso, el grant es invisible desde la interfaz.

## 9. Pruebas — `tests/partner-scope.test.js`

Patrón de `tests/auth-guards.test.js` (`node --test`, app Express mínima con el mismo orden de
wiring que `server.js`).

**La que importa de verdad:**

> Socio sube con `body.client_id` de una bóveda ajena → el archivo cae en la SUYA o da 403,
> **nunca** en la ajena.

Es el test de regresión del fail-open de §2. Si algún día alguien reintroduce un
`if (authMethod === 'api-key')` en una ruta de escritura, este test truena.

El resto:

1. Socio: `GET /api/files` devuelve la unión de sus bóvedas y nada más
2. Socio: `GET /api/files?client_id=<ajeno>` → 403
3. Socio: `GET /api/files/:id` de archivo ajeno → 403
4. Socio: `DELETE` / `replace` / cover de archivo ajeno → 403
5. Socio: `PATCH /files/:id` (mover) y `copy` → 403 (`requireSession`)
6. Socio: `GET /api/clients` devuelve sólo las suyas; `POST /api/clients` → 403
7. Socio: `/api/api-keys` → 403
8. Key revocada → su bóveda desaparece del scope
9. Admin key colgada a un socio → nunca entra al scope
10. Socio deshabilitado → login 401
11. Socio sin keys → 403 en rutas scoped, no 500 ni acceso total
12. **Regresión:** client key y admin key se comportan exactamente igual que antes del refactor

## 10. Archivos que se tocan

| Archivo | Cambio |
|---|---|
| `src/db/schema.sql` | tabla `partners` |
| `src/db/connection.js` | `ALTER TABLE api_keys ADD COLUMN partner_id` |
| `src/middleware/auth.js` | rama de socio, `callerScope()`, `publicPaths` |
| `src/routes/partner.js` | **nuevo** — `POST /login` |
| `src/routes/auth.js` | `status` reporta `role` |
| `src/routes/clients.js` | `GET /` admite socio y filtra por scope |
| `src/routes/files.js` | los 8 checks → `callerScope`; `fileToPartnerResponse`; atribución |
| `src/routes/overlay.js` | valida el `client_id` resuelto contra `callerScope` (hueco de §5) |
| `server.js` | monta `/api/partner`, sirve `/socios`, rate limiter del socio |
| `public/socios.html` | **nuevo** — puerta de contraseña |
| `public/js/app.js` | esconde controles de admin según `role` |
| `public/js/api.js` | 401 → `/socios`; `replaceFile()` |
| `public/js/gallery.js` | tooltip sin atribución para socios; acción Replace |
| `public/js/api-keys.js` | badge `socio: <name>` |
| `scripts/partners.js` | **nuevo** — CLI |
| `tests/partner-scope.test.js` | **nuevo** |
| `/etc/caddy/conf.d/luna.solutions45.com` | matcher `@socios` (fuera del repo) |
| `src/openapi.js` | bump de versión + nota del cambio de contrato del upload |
| `CLAUDE.md` | la tercera identidad |

## 11. Pendiente de decidir al desplegar

**La contraseña de richie.** El owner propuso `Solutions45`. Se le señaló una vez que en un
dominio llamado solutions45.com eso se adivina al segundo intento, y que esa puerta permite
borrar archivos de esas bóvedas. Queda por confirmar el valor final en el momento de correr
`scripts/partners.js create richie`. No se hardcodea en ningún lado: entra por el CLI.

## 12. Fuera de alcance (v1)

- UI de administración de socios (se hace por CLI; el badge da la visibilidad mínima)
- Más de un socio a la vez está soportado por el modelo, pero sólo se da de alta a richie
- Cambio de contraseña por el propio socio
- Log de auditoría de acciones del socio más allá de `files.api_key_id`
