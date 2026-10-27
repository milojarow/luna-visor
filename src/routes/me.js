const { Router } = require('express');
const path = require('path');
const db = require('../db/connection');
const config = require('../config');
const { getBranding, MINIMAL_LOGO_POSITIONS } = require('../services/cover-generator');

const router = Router();

router.get('/', (req, res) => {
  if (req.authMethod !== 'api-key') {
    return res.status(403).json({ error: 'X-API-Key required — this endpoint returns per-key context' });
  }

  if (req.isAdminKey) {
    const apiKey = db.prepare('SELECT id, name, key_preview, created_at FROM api_keys WHERE id = ?').get(req.apiKeyId);
    return res.json({
      api_key: {
        id: apiKey.id,
        name: apiKey.name,
        key_preview: apiKey.key_preview,
        created_at: apiKey.created_at,
        is_admin: true,
      },
      callable_endpoints: [
        'GET /api/clients',
        'POST /api/clients',
        'PATCH /api/clients/{id}',
        'GET /api/api-keys',
        'POST /api/api-keys',
        'PATCH /api/api-keys/{id}',
        'DELETE /api/api-keys/{id}',
        'GET /api/files',
        'GET /api/files/{id}',
      ],
      notes: [
        'Admin key: onboarding + key lifecycle — create/rename clients, mint/rename/revoke client-scoped keys. File writes require a client-scoped key; global metadata reads are allowed.',
        'GET /api/files and GET /api/files/{id} are READ-ONLY and cross-client: every file of every client, each row carrying client_id + client_name. Filter with ?client_id=N; page with ?limit=&offset= (both optional, no default).',
        'Writing files is closed to admin keys: upload, replace, delete, copy, move and cover generation all return 403. Mint a client-scoped key for that.',
        'POST /api/clients body: { name, is_ephemeral?, preserve_format? }. Returns 201 with the client row; 409 if the name already exists.',
        'preserve_format: true stores bytes and extension without conversion/variants, permanently unless is_ephemeral is also true. is_ephemeral also preserves format and sweeps files older than 24h by created_at, at boot/every 15 min; replace does not renew TTL. Both flags are create-time only; PATCH cannot change them. Extension/content allowlist still applies.',
        'PATCH /api/clients/{id} body: { name }. Renames the client (slug re-derives); 409 on name collision.',
        'POST /api/api-keys body: { name, client_id }. The raw key is returned ONCE — deliver it to the client app immediately.',
        'PATCH /api/api-keys/{id} body: { name }, and DELETE /api/api-keys/{id} (revoke, soft delete, immediate) — CLIENT keys only. Admin keys 403 — they are WUI-managed.',
        'Creating admin keys via API is forbidden (session/WUI only). Deleting clients is session-only too.',
      ],
    });
  }

  const client = db.prepare('SELECT id, name, slug, is_ephemeral, preserve_format, is_private FROM clients WHERE id = ?').get(req.apiKeyClientId);
  const apiKey = db.prepare('SELECT id, name, key_preview, created_at FROM api_keys WHERE id = ?').get(req.apiKeyId);
  const brand = client.is_private ? { ...getBranding(client.id), formats: [] } : getBranding(client.id);

  const isMinimal = brand.layout === 'minimal';
  const branding = {
    layout: brand.layout || 'default',
    available_cover_formats: brand.formats || [],
    cover_body_example: isMinimal ? { position: 'top-right' } : {
      operation: 'Casa en Venta',
      location: 'Reynosa, Tamaulipas',
      bedrooms: '3',
      bathrooms: '2',
      area: '140 m²',
      amenities: { parking: true, garden: false, trees: false },
    },
    watermark_text: brand.watermarkText || null,
    watermark_font: brand.watermarkFont || null,
  };

  if (brand.formats?.includes('watermark')) {
    branding.watermark_body_example = { logo_opacity: 0 };
  }

  if (brand.logoImagePath) {
    const filename = path.basename(brand.logoImagePath);
    branding.logo_cdn_url = `${config.CDN_BASE_URL}/${filename}`;
  }

  if (isMinimal) {
    branding.available_logo_positions = MINIMAL_LOGO_POSITIONS;
  }

  const coverEndpoints = (brand.formats || []).map(f => `POST /api/files/{id}/${f}`);
  const callable = [
    'GET /api/files',
    'GET /api/files/{id}',
    ...(client.is_private ? ['GET /api/files/{id}/content'] : []),
    'POST /api/files/upload',
    'POST /api/files/{id}/replace',
    'DELETE /api/files/{id}',
    ...coverEndpoints,
    'POST /api/overlay/generate',
  ];

  const notes = [
    'GET /api/files lists this client\'s vault and nothing else — the scope comes from the key, so no client_id is needed (and a foreign one is rejected). Page with ?limit=&offset= (both optional, no default). GET /api/files/{id} returns one file, 403 if it belongs to another client.',
    client.is_private ? 'Private bytes are stored outside the public CDN directory. cdn_url is an authenticated API content URL; send your client key server-side, never expose it in browser code. Public CDN guesses return no private bytes. Range/HEAD supported; responses are private, no-store.' : 'cdn_url returned from public-vault upload/cover endpoints is public (https://cdn.solutions45.com/<uuid>.<ext>).',
    'Upload uses multipart files (plural) and returns HTTP 201 with an array of {cdn_url} or {error} per item; inspect every item. GET /api/files includes id. Replace uses multipart file (singular) and returns an object {cdn_url}; preserves UUID but extension/URL can change: always use the returned cdn_url.',
    brand.formats?.includes('watermark') ? 'POST /api/files/{id}/watermark has its own optional WatermarkBody (not CoverBody): text, pattern_opacity, logo_opacity, logo_width_pct, logo_cx, logo_cy. Fractions are clamped to 0..1. New UUID, master unchanged; generator preserves dimensions, then the vault storage policy applies. See /api/openapi.json.' : null,
    isMinimal
      ? 'Cover endpoint accepts body `{}` (defaults to top-right) or `{position: "..."}` to choose a corner. Source dimensions are preserved.'
      : 'Cover endpoint requires a full CoverBody — see /api/openapi.json#components/schemas/CoverBody. Watermark, if enabled, uses a separate optional body.',
    isMinimal
      ? 'If the source image already has a logo in one corner, inspect it and pass a different `position` value to avoid overlapping the existing logo. Pass `"none"` to skip the logo entirely (watermark only) when the source already has a prominent brand mark.'
      : null,
    'Vault flags are create-time only. Raw/ephemeral still enforce extension and content validation.',
    client.is_ephemeral === 1 ? 'This is an ephemeral client — uploads preserve bytes/extension with no variants; files older than 24h by created_at are swept at boot and every 15 minutes. Replace does not renew created_at or expiry.' : null,
    client.preserve_format === 1 ? 'This is a preserve-format client — uploads are stored byte-for-byte with their original extension (no WebP/MP4 conversion, no -thumb variant). Permanent unless is_ephemeral is also true. Always use the returned cdn_url.' : null,
  ].filter(Boolean);

  res.json({
    client: {
      id: client.id,
      name: client.name,
      slug: client.slug,
      is_ephemeral: client.is_ephemeral === 1,
      preserve_format: client.preserve_format === 1,
      is_private: client.is_private === 1,
    },
    api_key: {
      id: apiKey.id,
      name: apiKey.name,
      key_preview: apiKey.key_preview,
      created_at: apiKey.created_at,
    },
    branding,
    rate_limits: {
      upload_per_minute: 60,
      cover_per_minute: 30,
      overlay_per_minute: 30,
    },
    callable_endpoints: callable,
    notes,
  });
});

module.exports = router;
