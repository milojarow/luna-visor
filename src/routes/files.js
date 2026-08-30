const { Router } = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const db = require('../db/connection');
const config = require('../config');
const { saveFile, deleteFile, moveFile, copyFile, replaceFile } = require('../services/file-manager');
const { generateCover, generateWatermark, getBranding, MINIMAL_LOGO_POSITIONS } = require('../services/cover-generator');
const { requireSession, blockAdminKeys, callerScope } = require('../middleware/auth');
const { validateUpload, sanitizeOriginalName, ValidationError } = require('../services/upload-validator');

const upload = multer({
  dest: '/tmp/luna-visor-uploads/',
  limits: { fileSize: 500 * 1024 * 1024, files: 20 },
});

const uploadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  keyGenerator: req => req.apiKeyClientId ? `key:${req.apiKeyClientId}` : `ip:${ipKeyGenerator(req.ip)}`,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many uploads, slow down.' },
});

const coverLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  keyGenerator: req => req.apiKeyClientId ? `cover-key:${req.apiKeyClientId}` : `cover-ip:${ipKeyGenerator(req.ip)}`,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many cover generations, slow down.' },
});

function cleanupTempFiles(req) {
  const files = (req.files || []).concat(req.file ? [req.file] : []);
  for (const f of files) {
    if (f && f.path) {
      try { fs.unlinkSync(f.path); } catch {}
    }
  }
}

const router = Router();

function fileToResponse(file) {
  if (!file) return null;
  const cdnUrl = `${config.CDN_BASE_URL}/${file.id}.${file.extension}`;
  return { ...file, cdn_url: cdnUrl };
}

// Projection for API-key callers. Built as an explicit allowlist, not a blocklist: internal
// audit metadata (api_key_id / api_key_name / api_key_revoked_at) never reaches an external
// caller, and a column added to the files table can't leak by accident.
function fileToKeyResponse(file, includeClientName) {
  if (!file) return null;
  const out = {
    id: file.id,
    cdn_url: `${config.CDN_BASE_URL}/${file.id}.${file.extension}`,
    client_id: file.client_id,
  };
  if (includeClientName) out.client_name = file.client_name;
  out.original_name = file.original_name;
  out.extension = file.extension;
  out.mime_type = file.mime_type;
  out.size_bytes = file.size_bytes;
  out.type = file.type;
  out.has_thumbnail = file.has_thumbnail;
  out.has_resized = file.has_resized;
  out.referenced = file.referenced;
  out.created_at = file.created_at;
  return out;
}

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

const FILE_SELECT = `
  SELECT f.*, ak.name AS api_key_name, ak.revoked_at AS api_key_revoked_at,
         c.name AS client_name, c.is_ephemeral AS client_is_ephemeral
  FROM files f
  LEFT JOIN api_keys ak ON ak.id = f.api_key_id
  LEFT JOIN clients c ON c.id = f.client_id
`;

// Pagination is opt-in with no default: the WUI gallery fetches GET /api/files unbounded
// (public/js/api.js), so any default cap would silently truncate it.
function parsePaging(query) {
  const paging = {};
  if (query.limit !== undefined) {
    const n = Number.parseInt(query.limit, 10);
    if (!Number.isInteger(n) || n < 1) return { error: 'limit must be a positive integer' };
    paging.limit = Math.min(n, 500);
  }
  if (query.offset !== undefined) {
    const n = Number.parseInt(query.offset, 10);
    if (!Number.isInteger(n) || n < 0) return { error: 'offset must be a non-negative integer' };
    paging.offset = n;
  }
  return { paging };
}

// Read routes are open to session, client keys (scoped to their own vault) and admin keys
// (cross-client, read-only). See the blockAdminKeys barrier below.
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
    if (!scope.length) return res.json([]);   // an empty IN () is a syntax error
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

// ---------------------------------------------------------------------------
// Barrier: every route defined BELOW this line is closed to admin keys (their
// client_id is NULL — they have no vault to write into). Fail-closed by design:
// a new route added below inherits the block without anyone remembering to.
// Read routes that admin keys may reach go ABOVE this line, deliberately.
// ---------------------------------------------------------------------------
router.use(blockAdminKeys);

router.post('/upload', uploadLimiter, upload.array('files', 20), async (req, res) => {
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

  if (!client_id) {
    cleanupTempFiles(req);
    return res.status(400).json({ error: 'client_id required' });
  }

  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(client_id);
  if (!client) {
    cleanupTempFiles(req);
    return res.status(404).json({ error: 'Client not found' });
  }

  const results = [];
  for (const f of req.files) {
    try {
      await validateUpload(f.path, f.originalname);
      const cleanName = sanitizeOriginalName(f.originalname);
      const file = await saveFile(f.path, cleanName, f.mimetype, f.size, client_id, apiKeyIdFor(req, client_id));
      results.push(fileToResponse(file));
    } catch (err) {
      try { fs.unlinkSync(f.path); } catch {}
      if (!(err instanceof ValidationError)) {
        console.error(`Failed to process ${f.originalname}:`, err);
      }
      results.push({ error: err.message, original_name: f.originalname });
    }
  }

  if (req.authMethod === 'api-key') {
    const minimal = results.map(r => r.error ? { error: r.error } : { cdn_url: r.cdn_url });
    return res.status(201).json(minimal);
  }
  if (req.authMethod === 'partner') {
    return res.status(201).json(results.map(r => r.error ? r : stripAttribution(r)));
  }
  res.status(201).json(results);
});

router.patch('/:id', requireSession, (req, res) => {
  const { client_id } = req.body;
  if (!client_id) {
    return res.status(400).json({ error: 'client_id required' });
  }
  const file = moveFile(req.params.id, client_id);
  if (!file) return res.status(404).json({ error: 'File or client not found' });
  res.json(fileToResponse(file));
});

router.post('/:id/replace', uploadLimiter, upload.single('file'), async (req, res) => {
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
  if (!req.file) {
    return res.status(400).json({ error: 'File required' });
  }
  try {
    await validateUpload(req.file.path, req.file.originalname);
    const cleanName = sanitizeOriginalName(req.file.originalname);
    const file = await replaceFile(req.params.id, req.file.path, cleanName, req.file.mimetype, req.file.size);
    if (!file) return res.status(404).json({ error: 'File not found' });
    const response = fileToResponse(file);
    if (req.authMethod === 'api-key') {
      return res.json({ cdn_url: response.cdn_url });
    }
    if (req.authMethod === 'partner') return res.json(stripAttribution(response));
    res.json(response);
  } catch (err) {
    try { fs.unlinkSync(req.file.path); } catch {}
    if (err instanceof ValidationError) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error('Replace failed:', err);
    return res.status(500).json({ error: 'Internal error during replace' });
  }
});

async function handleCoverGeneration(req, res, format, width, height) {
  const file = db.prepare('SELECT * FROM files WHERE id = ?').get(req.params.id);
  if (!file) return res.status(404).json({ error: 'File not found' });
  const scope = callerScope(req);
  if (scope && !scope.includes(file.client_id)) {
    return res.status(403).json({ error: 'Access denied' });
  }
  if (file.type !== 'image') {
    return res.status(400).json({ error: 'Source file must be an image' });
  }

  const brand = getBranding(file.client_id);
  if (!brand.formats.includes(format)) {
    return res.status(400).json({ error: `Format '${format}' not supported for this client` });
  }
  if (brand.layout === 'minimal' && req.body?.position && !MINIMAL_LOGO_POSITIONS.includes(req.body.position)) {
    return res.status(400).json({ error: `Invalid position '${req.body.position}'. Allowed: ${MINIMAL_LOGO_POSITIONS.join(', ')}.` });
  }

  const sourcePath = path.join(config.MEDIA_FILES_PATH, `${file.id}.${file.extension}`);
  const sourceBuffer = fs.readFileSync(sourcePath);
  const coverBuffer = await generateCover({ sourceBuffer, data: req.body, width, height, clientId: file.client_id });

  const tmpPath = path.join('/tmp/luna-visor-uploads/', `${format}-${file.id}.webp`);
  fs.writeFileSync(tmpPath, coverBuffer);
  const coverName = `${format}-${file.original_name.replace(/\.[^.]+$/, '')}.webp`;
  const saved = await saveFile(tmpPath, coverName, 'image/webp', coverBuffer.length, file.client_id, apiKeyIdFor(req, file.client_id));

  const response = fileToResponse(saved);
  if (req.authMethod === 'api-key') {
    return res.status(201).json({ cdn_url: response.cdn_url });
  }
  if (req.authMethod === 'partner') return res.status(201).json(stripAttribution(response));
  res.status(201).json(response);
}

router.post('/:id/story', coverLimiter, (req, res) => handleCoverGeneration(req, res, 'story', 1080, 1920));
router.post('/:id/cover', coverLimiter, (req, res) => handleCoverGeneration(req, res, 'cover', 1080, 1350));
router.post('/:id/square', coverLimiter, (req, res) => handleCoverGeneration(req, res, 'square', 1080, 1080));
router.post('/:id/fb', coverLimiter, (req, res) => handleCoverGeneration(req, res, 'fb', 1080, 1080));

// Watermark anti-robo. A diferencia de los covers, PRESERVA las dimensiones del
// original — no hay width/height fijos porque el pool mezcla 1080x1350 y 1080x1080.
// El resultado se guarda como archivo NUEVO (UUID nuevo): el master queda intacto.
router.post('/:id/watermark', coverLimiter, async (req, res) => {
  const file = db.prepare('SELECT * FROM files WHERE id = ?').get(req.params.id);
  if (!file) return res.status(404).json({ error: 'File not found' });
  const scope = callerScope(req);
  if (scope && !scope.includes(file.client_id)) {
    return res.status(403).json({ error: 'Access denied' });
  }
  if (file.type !== 'image') {
    return res.status(400).json({ error: 'Source file must be an image' });
  }

  const brand = getBranding(file.client_id);
  if (!brand.formats.includes('watermark')) {
    return res.status(400).json({ error: "Format 'watermark' not supported for this client" });
  }

  const sourcePath = path.join(config.MEDIA_FILES_PATH, `${file.id}.${file.extension}`);
  const sourceBuffer = fs.readFileSync(sourcePath);
  const out = await generateWatermark({ sourceBuffer, brand, opts: req.body || {} });

  const tmpPath = path.join('/tmp/luna-visor-uploads/', `watermark-${file.id}.webp`);
  fs.writeFileSync(tmpPath, out);
  const outName = `wm-${file.original_name.replace(/\.[^.]+$/, '')}.webp`;
  const saved = await saveFile(tmpPath, outName, 'image/webp', out.length, file.client_id, apiKeyIdFor(req, file.client_id));

  const response = fileToResponse(saved);
  if (req.authMethod === 'api-key') {
    return res.status(201).json({ cdn_url: response.cdn_url });
  }
  if (req.authMethod === 'partner') return res.status(201).json(stripAttribution(response));
  res.status(201).json(response);
});

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

router.post('/:id/copy', requireSession, async (req, res) => {
  const { client_id } = req.body;
  if (!client_id) {
    return res.status(400).json({ error: 'client_id required' });
  }
  const file = await copyFile(req.params.id, client_id);
  if (!file) return res.status(404).json({ error: 'File or client not found' });
  res.status(201).json(fileToResponse(file));
});

router.post('/scan-references', requireSession, (_req, res) => {
  const { scanReferences } = require('../services/log-scanner');
  const count = scanReferences();
  res.json({ ok: true, newly_referenced: count });
});

module.exports = router;
