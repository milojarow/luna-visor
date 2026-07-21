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
        'GET /api/api-keys',
        'POST /api/api-keys',
        'DELETE /api/api-keys/{id}',
      ],
      notes: [
        'Admin key: onboarding + key lifecycle — create clients, mint client-scoped keys, revoke client-scoped keys. File operations require a client-scoped key.',
        'POST /api/clients body: { name, is_ephemeral? }. Returns 201 with the client row; 409 if the name already exists.',
        'POST /api/api-keys body: { name, client_id }. The raw key is returned ONCE — deliver it to the client app immediately.',
        'DELETE /api/api-keys/{id} revokes CLIENT keys only (soft delete, immediate). Admin keys 403 — they are WUI-managed.',
        'Creating admin keys via API is forbidden (session/WUI only). Renaming keys and deleting/renaming clients are session-only too.',
      ],
    });
  }

  const client = db.prepare('SELECT id, name, slug, is_ephemeral FROM clients WHERE id = ?').get(req.apiKeyClientId);
  const apiKey = db.prepare('SELECT id, name, key_preview, created_at FROM api_keys WHERE id = ?').get(req.apiKeyId);
  const brand = getBranding(client.id);

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

  if (brand.logoImagePath) {
    const filename = path.basename(brand.logoImagePath);
    branding.logo_cdn_url = `${config.CDN_BASE_URL}/${filename}`;
  }

  if (isMinimal) {
    branding.available_logo_positions = MINIMAL_LOGO_POSITIONS;
  }

  const coverEndpoints = (brand.formats || []).map(f => `POST /api/files/{id}/${f}`);
  const callable = [
    'POST /api/files/upload',
    'POST /api/files/{id}/replace',
    'DELETE /api/files/{id}',
    ...coverEndpoints,
    'POST /api/overlay/generate',
  ];

  const notes = [
    'cdn_url returned from upload/cover endpoints is always public (https://cdn.solutions45.com/<uuid>.<ext>).',
    isMinimal
      ? 'Cover endpoint accepts body `{}` (defaults to top-right) or `{position: "..."}` to choose a corner. Source dimensions are preserved.'
      : 'Cover endpoint requires a full CoverBody — see /openapi.json#components/schemas/CoverBody.',
    isMinimal
      ? 'If the source image already has a logo in one corner, inspect it and pass a different `position` value to avoid overlapping the existing logo. Pass `"none"` to skip the logo entirely (watermark only) when the source already has a prominent brand mark.'
      : null,
    client.is_ephemeral === 1 ? 'This is an ephemeral client — uploads bypass transcoding and auto-delete after 24h.' : null,
  ].filter(Boolean);

  res.json({
    client: {
      id: client.id,
      name: client.name,
      slug: client.slug,
      is_ephemeral: client.is_ephemeral === 1,
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
