// OpenAPI 3.0.3 specification for Luna Visor CDN API.
// Served at GET /api/openapi.json — public, no auth required.
// Bump info.version when the contract changes (SemVer).

module.exports = {
  openapi: '3.0.3',
  info: {
    title: 'Luna Visor CDN API',
    version: '1.9.0',
    description: [
      'CDN manager for solutions45.com. Files uploaded here are stored on disk and served publicly at https://cdn.solutions45.com/{uuid}.{ext}.',
      '',
      '## Authentication',
      '',
      'Two methods, checked in this order:',
      '',
      '1. **`X-API-Key` header** — server-to-server. Two kinds:',
      '   - **Client-scoped** (`is_admin=0`): bound to a single `client_id`. Lists and reads that client\'s files, uploads, replaces, deletes them, and generates covers/overlays. Never sees another client\'s files.',
      '   - **Admin** (`is_admin=1`, `client_id` NULL): onboarding and key lifecycle (create/rename clients, mint/rename/revoke client keys), plus **read-only cross-client access to files** — `GET /files` and `GET /files/{id}` over every client. Every file-writing endpoint returns 403.',
      '   Keys are SHA-256 hashed at rest; the raw value is returned once at creation. Revoked keys (soft-delete) return 401.',
      '2. **Session cookie** (`connect.sid`, HttpOnly, 7-day) — for the WUI admin at https://luna.solutions45.com. Full access to all endpoints.',
      '',
      'Endpoints marked `apiKeyAuth OR cookieAuth` accept either. Endpoints marked `cookieAuth` only return **403** to API-key callers.',
      '',
      'Call `GET /me` with your key to get the exact endpoint list and body shapes for that key — no filtering of this spec by hand.',
      '',
      '## File storage standard',
      '',
      'Uploads are normalized by default: images → WebP (`2048×2048` + `300×300` thumb), videos → MP4 H.264/AAC. SVG, MP3, and `.lottie` are always passthrough — bytes preserved, no re-encoding.',
      '',
      'Two per-client flags opt out of normalization entirely, storing every upload byte-for-byte under its original extension. They are independent, and both are fixed at create time:',
      '',
      '- `preserve_format=1` — permanent raw vault. Nothing expires.',
      '- `is_ephemeral=1` — temp content. Every file auto-deletes 24h after upload.',
      '',
      'In both cases the uploaded extension is the one that ends up in `cdn_url`, and no `-thumb` variant exists.',
      '',
      '## Public file URLs',
      '',
      'Every successful upload/replace/cover response includes a `cdn_url` pointing to https://cdn.solutions45.com — public, no auth, supports Range requests, CORS open.',
    ].join('\n'),
    contact: {
      name: 'Operator',
      url: 'https://luna.solutions45.com',
    },
  },

  servers: [
    { url: 'https://luna.solutions45.com/api', description: 'Production' },
  ],

  tags: [
    { name: 'Discovery', description: 'API metadata (this spec).' },
    { name: 'Auth', description: 'Session login/logout/status.' },
    { name: 'Clients', description: 'Logical owners of files. Create/list/rename accept session or admin key; delete is session-only.' },
    { name: 'Files', description: 'Upload, list, replace, move, copy, delete files. UUIDs are public identifiers. Listing/reading is scoped by caller: client keys see only their own vault, admin keys read across all clients, session sees everything.' },
    { name: 'Covers', description: 'Branded Instagram/Facebook images (1080×1920 / 1080×1350 / 1080×1080). Per-client branding registry.' },
    { name: 'Overlay', description: 'Transparent PNG overlays for video compositing (video-forge integration).' },
    { name: 'ApiKeys', description: 'Manage server-to-server credentials. Create+list accept session or admin key; admin keys themselves are mintable only via session. Rename/revoke: session, or admin key (client keys only — admin-key targets are WUI-managed).' },
  ],

  components: {
    securitySchemes: {
      apiKeyAuth: {
        type: 'apiKey',
        in: 'header',
        name: 'X-API-Key',
        description: 'Server-to-server credential. Client-scoped keys read and write files within their own client; admin keys (is_admin=1) create clients, mint client keys, and read files across all clients (read-only — every file write is 403). Soft-revocable.',
      },
      cookieAuth: {
        type: 'apiKey',
        in: 'cookie',
        name: 'connect.sid',
        description: 'Express-session cookie. HttpOnly, 7-day TTL. Obtained via POST /auth/login.',
      },
    },

    schemas: {
      Error: {
        type: 'object',
        required: ['error'],
        properties: {
          error: { type: 'string', example: 'Not authenticated' },
        },
      },

      Ok: {
        type: 'object',
        required: ['ok'],
        properties: {
          ok: { type: 'boolean', example: true },
        },
      },

      Client: {
        type: 'object',
        required: ['id', 'name', 'slug', 'is_ephemeral', 'preserve_format'],
        properties: {
          id: { type: 'integer', example: 2 },
          name: { type: 'string', example: 'posteacasa' },
          slug: { type: 'string', example: 'posteacasa', description: 'kebab-case lowercased name.' },
          is_ephemeral: { type: 'integer', enum: [0, 1], example: 0, description: '1 = uploads bypass transcoding and auto-delete after 24h.' },
          preserve_format: { type: 'integer', enum: [0, 1], example: 0, description: '1 = uploads stored byte-for-byte with their original extension, kept indefinitely. Independent of is_ephemeral.' },
          created_at: { type: 'string', format: 'date-time', example: '2026-04-12 18:33:00' },
          file_count: { type: 'integer', example: 142, description: 'Present only on GET /clients list responses.' },
        },
      },

      File: {
        type: 'object',
        required: ['id', 'extension', 'mime_type', 'type', 'client_id', 'cdn_url'],
        properties: {
          id: { type: 'string', format: 'uuid', example: '2d310796-1022-44ab-98c3-17485f80966f' },
          original_name: { type: 'string', example: 'beach-photo' },
          extension: { type: 'string', example: 'webp' },
          mime_type: { type: 'string', example: 'image/webp' },
          size_bytes: { type: 'integer', example: 184523 },
          client_id: { type: 'integer', example: 2 },
          api_key_id: { type: 'integer', nullable: true, example: 7, description: 'Which API key uploaded this file. NULL for session uploads and pre-2026-05-09 rows.' },
          api_key_name: { type: 'string', nullable: true, example: 'key para posteacasa', description: 'Joined from api_keys table.' },
          api_key_revoked_at: { type: 'string', format: 'date-time', nullable: true, description: 'Non-null if the key that uploaded this file has been revoked.' },
          type: { type: 'string', enum: ['image', 'video', 'audio', 'vector', 'lottie'], example: 'image' },
          has_thumbnail: { type: 'integer', enum: [0, 1], example: 0, description: '1 if a -thumb.jpg variant exists (videos).' },
          has_resized: { type: 'integer', enum: [0, 1], example: 1, description: '1 if image variants (-thumb.webp, -md.webp) exist.' },
          referenced: { type: 'integer', enum: [0, 1], example: 1, description: '1 once the CDN log scanner has seen this file fetched.' },
          created_at: { type: 'string', format: 'date-time' },
          updated_at: { type: 'string', format: 'date-time' },
          client_is_ephemeral: { type: 'integer', enum: [0, 1], example: 0 },
          cdn_url: { type: 'string', format: 'uri', example: 'https://cdn.solutions45.com/2d310796-1022-44ab-98c3-17485f80966f.webp' },
        },
      },

      FileMinimal: {
        type: 'object',
        required: ['cdn_url'],
        description: 'Response shape returned to API-key callers on upload/replace/cover. Internal IDs are not exposed.',
        properties: {
          cdn_url: { type: 'string', format: 'uri', example: 'https://cdn.solutions45.com/2d310796-1022-44ab-98c3-17485f80966f.webp' },
        },
      },

      FileKeyView: {
        type: 'object',
        required: ['id', 'cdn_url', 'client_id', 'extension', 'mime_type', 'type'],
        description: 'Response shape returned to API-key callers on GET /files and GET /files/{id}. Upload attribution (`api_key_id`, `api_key_name`, `api_key_revoked_at`) is internal audit metadata and is never exposed to API-key callers — use session auth (the WUI) for that.',
        properties: {
          id: { type: 'string', format: 'uuid', example: '2d310796-1022-44ab-98c3-17485f80966f' },
          cdn_url: { type: 'string', format: 'uri', example: 'https://cdn.solutions45.com/2d310796-1022-44ab-98c3-17485f80966f.webp' },
          client_id: { type: 'integer', example: 6 },
          client_name: { type: 'string', example: 'tacos-elcamioncito', description: 'Present for ADMIN keys only — client-scoped keys already know their own client.' },
          original_name: { type: 'string', example: 'beach-photo' },
          extension: { type: 'string', example: 'webp' },
          mime_type: { type: 'string', example: 'image/webp' },
          size_bytes: { type: 'integer', example: 184523 },
          type: { type: 'string', enum: ['image', 'video', 'audio', 'vector', 'lottie'], example: 'image' },
          has_thumbnail: { type: 'integer', enum: [0, 1], example: 0, description: '1 if a -thumb.jpg variant exists (videos).' },
          has_resized: { type: 'integer', enum: [0, 1], example: 1, description: '1 if image variants (-thumb.webp, -md.webp) exist.' },
          referenced: { type: 'integer', enum: [0, 1], example: 1, description: '1 once the CDN log scanner has seen this file fetched.' },
          created_at: { type: 'string', format: 'date-time' },
        },
      },

      UploadItemResult: {
        oneOf: [
          { $ref: '#/components/schemas/File' },
          { $ref: '#/components/schemas/FileMinimal' },
          {
            type: 'object',
            description: 'Failure shape for a single file inside a multi-file upload. Other files in the same batch may have succeeded.',
            required: ['error'],
            properties: {
              error: { type: 'string', example: 'File extension ".pdf" not allowed. Allowed: image (...), video (...), audio (mp3), vector (svg), lottie (.lottie).' },
              original_name: { type: 'string', example: 'document.pdf', description: 'Returned to session callers only.' },
            },
          },
        ],
      },

      ApiKey: {
        type: 'object',
        required: ['id', 'name', 'key_preview'],
        properties: {
          id: { type: 'integer', example: 7 },
          name: { type: 'string', example: 'key para posteacasa' },
          key_preview: { type: 'string', example: '4f2a', description: 'Last 4 chars of the raw key, for identification.' },
          client_id: { type: 'integer', nullable: true, example: 2, description: 'NULL for admin keys.' },
          client_name: { type: 'string', nullable: true, example: 'posteacasa', description: 'NULL for admin keys.' },
          is_admin: { type: 'integer', enum: [0, 1], example: 0, description: '1 = admin key (client/key onboarding, no file access, client_id NULL).' },
          created_at: { type: 'string', format: 'date-time' },
          revoked_at: { type: 'string', format: 'date-time', nullable: true, description: 'Non-null = soft-deleted; auth lookups skip revoked keys.' },
        },
      },

      ApiKeyCreated: {
        type: 'object',
        required: ['id', 'name', 'key', 'key_preview'],
        description: 'Returned ONCE on creation. The `key` value cannot be retrieved later — store it now.',
        properties: {
          id: { type: 'integer', example: 7 },
          name: { type: 'string', example: 'key para posteacasa' },
          key: { type: 'string', example: 'a1b2c3d4e5f6...64hex', description: 'Raw API key. 64 hex chars (32 bytes). Use as X-API-Key header.' },
          key_preview: { type: 'string', example: '4f2a' },
          client_id: { type: 'integer', nullable: true, example: 2, description: 'NULL for admin keys.' },
          client_name: { type: 'string', nullable: true, example: 'posteacasa', description: 'NULL for admin keys.' },
          is_admin: { type: 'integer', enum: [0, 1], example: 0, description: '1 = admin key (client/key onboarding, no file access, client_id NULL).' },
        },
      },

      CoverBody: {
        type: 'object',
        required: ['operation', 'location', 'bedrooms', 'bathrooms', 'area'],
        description: 'Real-estate cover content. Composited as SVG overlay onto the source image. Used by clients with the default (real-estate) layout, e.g. posteacasa (client_id=2).',
        properties: {
          operation: { type: 'string', example: 'Casa en Venta' },
          location: { type: 'string', example: 'Reynosa, Tamaulipas' },
          bedrooms: { type: 'string', example: '3' },
          bathrooms: { type: 'string', example: '2½' },
          area: { type: 'string', example: '140 m²' },
          amenities: {
            type: 'object',
            description: 'Optional. Each true flag adds a pill to the cover.',
            properties: {
              parking: { type: 'boolean', example: true },
              garden: { type: 'boolean', example: false },
              trees: { type: 'boolean', example: false },
            },
          },
        },
      },

      MinimalCoverBody: {
        type: 'object',
        description: 'Body for clients with `layout: "minimal"` in branding.config.js (e.g. tacos-elcamioncito, client_id=6). All fields optional — sending `{}` is valid. The minimal layout composites the client logo in one corner and a diagonal text watermark over the center, preserving source dimensions.',
        additionalProperties: false,
        properties: {
          position: {
            type: 'string',
            enum: ['top-right', 'top-left', 'bottom-right', 'bottom-left', 'none'],
            default: 'top-right',
            description: 'Which corner to place the logo. Useful when the source image already has a logo in one corner — pick a different one to avoid overlap. Use `"none"` to skip the logo entirely (only the diagonal watermark is applied) — useful when the source already includes a big, polished brand mark and you only want the anti-theft watermark.',
          },
        },
        example: { position: 'bottom-left' },
      },

      OverlayBody: {
        allOf: [
          { $ref: '#/components/schemas/CoverBody' },
          {
            type: 'object',
            properties: {
              width: { type: 'integer', default: 1080, example: 1080 },
              height: { type: 'integer', default: 1920, example: 1920 },
              client_id: { type: 'integer', example: 2, description: 'Required for session auth. Ignored for API-key auth (taken from the key).' },
            },
          },
        ],
      },

      MeResponse: {
        type: 'object',
        description: 'Per-key configuration returned by GET /me. Tells the caller everything they need to know about their key: which client they belong to, the branding layout (default vs minimal), the body shape expected by cover endpoints, the watermark text, the logo URL, and which endpoints they can call.',
        required: ['client', 'api_key', 'branding', 'rate_limits', 'callable_endpoints'],
        properties: {
          client: {
            type: 'object',
            required: ['id', 'name', 'slug', 'is_ephemeral', 'preserve_format'],
            properties: {
              id: { type: 'integer', example: 6 },
              name: { type: 'string', example: 'tacos-elcamioncito' },
              slug: { type: 'string', example: 'tacos-elcamioncito' },
              is_ephemeral: { type: 'boolean', example: false, description: 'true = uploads bypass transcoding and auto-delete after 24h.' },
              preserve_format: { type: 'boolean', example: false, description: 'true = uploads stored byte-for-byte with their original extension, kept indefinitely.' },
            },
          },
          api_key: {
            type: 'object',
            required: ['id', 'name', 'key_preview', 'created_at'],
            properties: {
              id: { type: 'integer', example: 12 },
              name: { type: 'string', example: 'key para backend tacos' },
              key_preview: { type: 'string', example: '4f2a', description: 'Last 4 chars of the raw key.' },
              created_at: { type: 'string', format: 'date-time' },
            },
          },
          branding: {
            type: 'object',
            required: ['layout', 'available_cover_formats', 'cover_body_example'],
            properties: {
              layout: { type: 'string', enum: ['default', 'minimal'], example: 'minimal', description: '`default` = real-estate-style cover (logo + gradient dim + info pills + operation/location text). `minimal` = logo top-right + diagonal text watermark only, source dimensions preserved.' },
              available_cover_formats: { type: 'array', items: { type: 'string', enum: ['story', 'cover', 'square', 'fb'] }, example: ['story'], description: 'Whitelist of cover format endpoints the client can call. Formats not listed return 400.' },
              cover_body_example: { type: 'object', description: 'A valid example body for the cover endpoints. `{}` for `minimal` layout, a full CoverBody for `default`.' },
              watermark_text: { type: 'string', nullable: true, example: 'TACOS EL CAMIONCITO' },
              watermark_font: { type: 'string', nullable: true, example: "'Inter', sans-serif" },
              logo_cdn_url: { type: 'string', format: 'uri', nullable: true, example: 'https://cdn.solutions45.com/18fc43cf-4fe4-4d63-9202-403fce18cf93.webp', description: 'Public CDN URL of the logo image used by cover/overlay endpoints. Omitted if the brand has no logo.' },
              available_logo_positions: {
                type: 'array',
                items: { type: 'string', enum: ['top-right', 'top-left', 'bottom-right', 'bottom-left', 'none'] },
                example: ['top-right', 'top-left', 'bottom-right', 'bottom-left', 'none'],
                description: 'Values accepted by `position` in the cover body. `"none"` means: skip the logo, apply only the watermark — use this when the source already has a prominent brand mark of its own. Only present when `layout === "minimal"`.',
              },
            },
          },
          rate_limits: {
            type: 'object',
            properties: {
              upload_per_minute: { type: 'integer', example: 60 },
              cover_per_minute: { type: 'integer', example: 30 },
              overlay_per_minute: { type: 'integer', example: 30 },
            },
          },
          callable_endpoints: {
            type: 'array',
            items: { type: 'string' },
            example: [
              'POST /api/files/upload',
              'POST /api/files/{id}/replace',
              'DELETE /api/files/{id}',
              'POST /api/files/{id}/story',
              'POST /api/overlay/generate',
            ],
            description: 'Endpoints the key may invoke. Cover endpoints are included only for formats in `available_cover_formats`.',
          },
          notes: {
            type: 'array',
            items: { type: 'string' },
            description: 'Free-form context lines: how cdn_url is built, what body shape the cover endpoint wants, whether the client is ephemeral, etc.',
          },
        },
      },
    },

    responses: {
      Unauthorized: {
        description: 'No valid credentials (missing session and missing/invalid X-API-Key).',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' }, example: { error: 'Not authenticated' } } },
      },
      Forbidden: {
        description: 'Authenticated but not authorized: API key trying to touch another client\'s resource, or API key on a session-only endpoint.',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' }, example: { error: 'Access denied' } } },
      },
      NotFound: {
        description: 'Resource not found.',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' }, example: { error: 'File not found' } } },
      },
      BadRequest: {
        description: 'Validation error (missing field, invalid format, unsupported file type, etc.).',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
      },
      Conflict: {
        description: 'Constraint violation (duplicate slug, client has files, etc.).',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
      },
    },

    parameters: {
      FileId: {
        name: 'id',
        in: 'path',
        required: true,
        schema: { type: 'string', format: 'uuid' },
        description: 'File UUID.',
      },
      ClientIdParam: {
        name: 'id',
        in: 'path',
        required: true,
        schema: { type: 'integer' },
        description: 'Client numeric ID.',
      },
      ApiKeyIdParam: {
        name: 'id',
        in: 'path',
        required: true,
        schema: { type: 'integer' },
        description: 'API key numeric ID.',
      },
    },
  },

  paths: {
    // ---------- Discovery ----------
    '/openapi.json': {
      get: {
        tags: ['Discovery'],
        summary: 'Get this OpenAPI 3.0.3 specification.',
        description: 'Returns the JSON spec describing every endpoint, schema, and security scheme. Public — no auth required. Use this from an agent to onboard against the API.',
        security: [],
        responses: {
          200: {
            description: 'OpenAPI 3.0.3 document.',
            content: { 'application/json': { schema: { type: 'object' } } },
          },
        },
      },
    },
    '/me': {
      get: {
        tags: ['Discovery'],
        summary: 'Per-key context: client, branding, callable endpoints, body shapes.',
        description: [
          'Returns the configuration relevant to the authenticated API key. **Call this once at startup** to know exactly what your key can do — what client you belong to, which cover formats are enabled, what body shape to send to cover endpoints (`{}` for minimal layout vs full CoverBody for default), the watermark text, and the logo URL.',
          '',
          'Standard `/me` pattern (Stripe, GitHub, etc.). Filters the global `/openapi.json` down to just what applies to your key — no mental filtering required.',
          '',
          'Requires `X-API-Key`. Session auth returns 403 (sessions already have the WUI to inspect everything).',
          '',
          'Admin keys receive `{ api_key, callable_endpoints, notes }` — no client/branding context.',
        ].join('\n'),
        security: [{ apiKeyAuth: [] }],
        responses: {
          200: {
            description: 'Per-key config.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/MeResponse' } } },
          },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: {
            description: 'Session auth was used instead of X-API-Key.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' }, example: { error: 'X-API-Key required — this endpoint returns per-key context' } } },
          },
        },
      },
    },

    // ---------- Auth ----------
    '/auth/status': {
      get: {
        tags: ['Auth'],
        summary: 'Check session status and get CDN base URL.',
        security: [],
        responses: {
          200: {
            description: 'Session status.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    authenticated: { type: 'boolean' },
                    cdn_base_url: { type: 'string', example: 'https://cdn.solutions45.com' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Log in with the admin password.',
        description: 'Rate-limited: 20 attempts per 15 min per IP, successful logins do not count. Sets the connect.sid cookie on success.',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['password'],
                properties: { password: { type: 'string', format: 'password' } },
              },
            },
          },
        },
        responses: {
          200: { description: 'Logged in; session cookie set.', content: { 'application/json': { schema: { $ref: '#/components/schemas/Ok' } } } },
          400: { $ref: '#/components/responses/BadRequest' },
          401: { description: 'Wrong password.', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          429: { description: 'Too many attempts.', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/auth/logout': {
      post: {
        tags: ['Auth'],
        summary: 'Destroy the current session.',
        security: [{ cookieAuth: [] }],
        responses: {
          200: { description: 'Session destroyed.', content: { 'application/json': { schema: { $ref: '#/components/schemas/Ok' } } } },
        },
      },
    },

    // ---------- Clients ----------
    '/clients': {
      get: {
        tags: ['Clients'],
        summary: 'List all clients with file counts. Session or admin key (client-scoped keys get 403).',
        security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
        responses: {
          200: {
            description: 'Array of clients ordered by name.',
            content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Client' } } } },
          },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { $ref: '#/components/responses/Forbidden' },
        },
      },
      post: {
        tags: ['Clients'],
        summary: 'Create a new client. Session or admin key (client-scoped keys get 403).',
        description: 'Two optional, independent flags — both fixed at create time, neither changeable via PATCH.\n\n- `preserve_format: true` → permanent raw vault: uploads stored byte-for-byte with their original extension, never expire.\n- `is_ephemeral: true` → temp client: same byte-for-byte storage, but every file auto-deletes 24h after upload.',
        security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name'],
                properties: {
                  name: { type: 'string', example: 'new-client' },
                  is_ephemeral: { type: 'boolean', default: false, description: 'Files auto-delete 24h after upload.' },
                  preserve_format: { type: 'boolean', default: false, description: 'Store uploads byte-for-byte with their original extension. Permanent.' },
                },
              },
            },
          },
        },
        responses: {
          201: { description: 'Client created.', content: { 'application/json': { schema: { $ref: '#/components/schemas/Client' } } } },
          400: { $ref: '#/components/responses/BadRequest' },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { $ref: '#/components/responses/Forbidden' },
          409: { $ref: '#/components/responses/Conflict' },
        },
      },
    },
    '/clients/{id}': {
      parameters: [{ $ref: '#/components/parameters/ClientIdParam' }],
      patch: {
        tags: ['Clients'],
        summary: 'Rename a client. Session or admin key.',
        description: 'The slug re-derives from the new name. 409 if another client already has that name.',
        security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name'],
                properties: { name: { type: 'string' } },
              },
            },
          },
        },
        responses: {
          200: { description: 'Updated client.', content: { 'application/json': { schema: { $ref: '#/components/schemas/Client' } } } },
          400: { $ref: '#/components/responses/BadRequest' },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { $ref: '#/components/responses/Forbidden' },
          404: { $ref: '#/components/responses/NotFound' },
          409: { $ref: '#/components/responses/Conflict' },
        },
      },
      delete: {
        tags: ['Clients'],
        summary: 'Delete a client.',
        description: 'Blocked (409) if the client still has files or active (non-revoked) API keys.',
        security: [{ cookieAuth: [] }],
        responses: {
          200: { description: 'Deleted.', content: { 'application/json': { schema: { $ref: '#/components/schemas/Ok' } } } },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { $ref: '#/components/responses/Forbidden' },
          404: { $ref: '#/components/responses/NotFound' },
          409: { $ref: '#/components/responses/Conflict' },
        },
      },
    },

    // ---------- Files ----------
    '/files': {
      get: {
        tags: ['Files'],
        summary: 'List files. Scope is derived from the caller.',
        description: [
          'Ordered by `created_at` DESC. **The result set is scoped by who is asking** — a client-scoped key can never enumerate another client\'s vault:',
          '',
          '| Caller | Sees | Response schema |',
          '|---|---|---|',
          '| Client-scoped key | Only its own client\'s files. `client_id` is implicit; passing a foreign one is **403**, never a silent re-scope | `FileKeyView` |',
          '| Admin key | Every client\'s files, each row carrying `client_id` + `client_name`. Optional `?client_id=N` filter | `FileKeyView` (with `client_name`) |',
          '| Session | Every client\'s files, optional `?client_id=N` filter | `File` (full row, incl. upload attribution) |',
          '',
          '`limit`/`offset` are **optional with no default** — omit both and you get the complete set.',
        ].join('\n'),
        security: [{ apiKeyAuth: [] }, { cookieAuth: [] }],
        parameters: [
          { name: 'client_id', in: 'query', required: false, schema: { type: 'integer' }, description: 'Filter to a single client. Ignored-and-enforced for client-scoped keys: omit it, or pass your own (a foreign value returns 403).' },
          { name: 'limit', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 500 }, description: 'Max rows to return. Values above 500 are capped. Omit for no limit.' },
          { name: 'offset', in: 'query', required: false, schema: { type: 'integer', minimum: 0 }, description: 'Rows to skip. Usable on its own (no limit needed).' },
        ],
        responses: {
          200: {
            description: 'Array of files ordered by created_at DESC. Shape depends on auth method (see table above).',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: {
                    oneOf: [
                      { $ref: '#/components/schemas/FileKeyView' },
                      { $ref: '#/components/schemas/File' },
                    ],
                  },
                },
              },
            },
          },
          400: { $ref: '#/components/responses/BadRequest' },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { $ref: '#/components/responses/Forbidden' },
        },
      },
    },
    '/files/upload': {
      post: {
        tags: ['Files'],
        summary: 'Upload one or more files.',
        description: [
          'Multipart. Up to 20 files per request, 500 MB each. Rate limited to 60 uploads/min per API key (or per IP for session auth).',
          '',
          '**For API key callers**: `client_id` is implicit (the key\'s client). Response is a minimal array `[{cdn_url}]` per file. Failed items show `{error}`.',
          '',
          '**For session callers**: `client_id` is required in the multipart body. Response is an array of full File objects.',
          '',
          'Allowed extensions: `jpg/jpeg/png/gif/webp/avif/heic/heif` (images, re-encoded to WebP with `-thumb` variant), `mp4/mov/webm/mkv` (videos, re-encoded to MP4 H.264/AAC), `mp3`, `svg`, `lottie`. Images for ephemeral clients are passthrough (no re-encode). `.lottie` is passthrough regardless of client.',
        ].join('\n'),
        security: [{ apiKeyAuth: [] }, { cookieAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                required: ['files'],
                properties: {
                  files: { type: 'array', items: { type: 'string', format: 'binary' }, maxItems: 20 },
                  client_id: { type: 'integer', description: 'Required for session auth. Ignored for API-key auth.' },
                },
              },
            },
          },
        },
        responses: {
          201: { description: 'Array of per-file results (success or error). Order matches input order.', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/UploadItemResult' } } } } },
          400: { $ref: '#/components/responses/BadRequest' },
          401: { $ref: '#/components/responses/Unauthorized' },
          404: { $ref: '#/components/responses/NotFound' },
          413: { description: 'File too large (>500 MB) or too many files (>20).', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          429: { description: 'Rate limit exceeded.', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/files/scan-references': {
      post: {
        tags: ['Files'],
        summary: 'Trigger an immediate CDN log scan.',
        description: 'Marks files as `referenced=1` when they appear in the CDN access log. Normally runs every 5 min automatically.',
        security: [{ cookieAuth: [] }],
        responses: {
          200: {
            description: 'Scan result.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    ok: { type: 'boolean' },
                    newly_referenced: { type: 'integer', example: 3 },
                  },
                },
              },
            },
          },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { $ref: '#/components/responses/Forbidden' },
        },
      },
    },
    '/files/{id}': {
      parameters: [{ $ref: '#/components/parameters/FileId' }],
      get: {
        tags: ['Files'],
        summary: 'Get a single file.',
        description: 'Client-scoped keys may only read their own client\'s files (403 otherwise). Admin keys read any file (read-only) and additionally get `client_name`. Session callers get the full `File` row including upload attribution.',
        security: [{ apiKeyAuth: [] }, { cookieAuth: [] }],
        responses: {
          200: {
            description: 'File object. `FileKeyView` for API-key callers, full `File` for session callers.',
            content: {
              'application/json': {
                schema: {
                  oneOf: [
                    { $ref: '#/components/schemas/FileKeyView' },
                    { $ref: '#/components/schemas/File' },
                  ],
                },
              },
            },
          },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { $ref: '#/components/responses/Forbidden' },
          404: { $ref: '#/components/responses/NotFound' },
        },
      },
      patch: {
        tags: ['Files'],
        summary: 'Move a file to a different client.',
        security: [{ cookieAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { type: 'object', required: ['client_id'], properties: { client_id: { type: 'integer' } } },
            },
          },
        },
        responses: {
          200: { description: 'Updated file.', content: { 'application/json': { schema: { $ref: '#/components/schemas/File' } } } },
          400: { $ref: '#/components/responses/BadRequest' },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { $ref: '#/components/responses/Forbidden' },
          404: { $ref: '#/components/responses/NotFound' },
        },
      },
      delete: {
        tags: ['Files'],
        summary: 'Delete a file and all its variants.',
        description: 'API key callers may only delete files belonging to their own client (403 otherwise).',
        security: [{ apiKeyAuth: [] }, { cookieAuth: [] }],
        responses: {
          200: { description: 'Deleted.', content: { 'application/json': { schema: { $ref: '#/components/schemas/Ok' } } } },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { $ref: '#/components/responses/Forbidden' },
          404: { $ref: '#/components/responses/NotFound' },
        },
      },
    },
    '/files/{id}/replace': {
      parameters: [{ $ref: '#/components/parameters/FileId' }],
      post: {
        tags: ['Files'],
        summary: 'Replace a file in-place, preserving the UUID.',
        description: 'The CDN URL stays valid (same UUID). The extension may change (e.g. legacy `.jpg` becomes `.webp` after replace). API key callers: ownership enforced (403 if file belongs to another client).',
        security: [{ apiKeyAuth: [] }, { cookieAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                required: ['file'],
                properties: {
                  file: { type: 'string', format: 'binary' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Replaced. Returns full File for session, FileMinimal for API key.',
            content: { 'application/json': { schema: { oneOf: [{ $ref: '#/components/schemas/File' }, { $ref: '#/components/schemas/FileMinimal' }] } } },
          },
          400: { $ref: '#/components/responses/BadRequest' },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { $ref: '#/components/responses/Forbidden' },
          404: { $ref: '#/components/responses/NotFound' },
          429: { description: 'Rate limit exceeded.', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/files/{id}/copy': {
      parameters: [{ $ref: '#/components/parameters/FileId' }],
      post: {
        tags: ['Files'],
        summary: 'Copy a file to a different client.',
        description: 'Creates a new UUID; original is preserved.',
        security: [{ cookieAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { type: 'object', required: ['client_id'], properties: { client_id: { type: 'integer' } } },
            },
          },
        },
        responses: {
          201: { description: 'New file.', content: { 'application/json': { schema: { $ref: '#/components/schemas/File' } } } },
          400: { $ref: '#/components/responses/BadRequest' },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { $ref: '#/components/responses/Forbidden' },
          404: { $ref: '#/components/responses/NotFound' },
        },
      },
    },

    // ---------- Covers ----------
    '/files/{id}/story': makeCoverPath('story', 1080, 1920, 'Instagram story / reel'),
    '/files/{id}/cover': makeCoverPath('cover', 1080, 1350, 'Instagram feed post'),
    '/files/{id}/square': makeCoverPath('square', 1080, 1080, 'Instagram square post'),
    '/files/{id}/fb': makeCoverPath('fb', 1080, 1080, 'Facebook post'),

    // ---------- Overlay ----------
    '/overlay/generate': {
      post: {
        tags: ['Overlay'],
        summary: 'Generate a transparent PNG overlay for video compositing.',
        description: [
          'Returns the PNG buffer directly (Content-Type: image/png). NOT saved to luna — caller decides what to do with it. Used by video-forge for FFmpeg compositing onto videos.',
          '',
          'Rate limited to 30 generations/min per API key (or per IP).',
        ].join('\n'),
        security: [{ apiKeyAuth: [] }, { cookieAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/OverlayBody' },
            },
          },
        },
        responses: {
          200: {
            description: 'Transparent PNG buffer.',
            content: { 'image/png': { schema: { type: 'string', format: 'binary' } } },
          },
          400: { $ref: '#/components/responses/BadRequest' },
          401: { $ref: '#/components/responses/Unauthorized' },
          429: { description: 'Rate limit exceeded.', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          500: { description: 'Generation failed.', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },

    // ---------- API keys ----------
    '/api-keys': {
      get: {
        tags: ['ApiKeys'],
        summary: 'List all API keys (active first, revoked last). Session or admin key (client-scoped keys get 403).',
        security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
        responses: {
          200: { description: 'Array of API keys.', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/ApiKey' } } } } },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { $ref: '#/components/responses/Forbidden' },
        },
      },
      post: {
        tags: ['ApiKeys'],
        summary: 'Create a new API key. Raw key is returned ONCE. Session or admin key (client-scoped keys get 403).',
        security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name'],
                properties: {
                  name: { type: 'string', example: 'key para nuevo-cliente' },
                  client_id: { type: 'integer', description: 'Required unless is_admin. Must be omitted when is_admin=true (400).' },
                  is_admin: { type: 'boolean', default: false, description: 'Mint an admin key. Session-only — API-key callers get 403.' },
                },
              },
            },
          },
        },
        responses: {
          201: { description: 'Key created. Save the `key` field — it cannot be retrieved later.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiKeyCreated' } } } },
          400: { $ref: '#/components/responses/BadRequest' },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { $ref: '#/components/responses/Forbidden' },
          404: { $ref: '#/components/responses/NotFound' },
        },
      },
    },
    '/api-keys/{id}': {
      parameters: [{ $ref: '#/components/parameters/ApiKeyIdParam' }],
      patch: {
        tags: ['ApiKeys'],
        summary: 'Rename an API key. Session or admin key (client keys only).',
        description: 'Admin-key callers can rename CLIENT keys only — renaming an admin key returns 403; admin keys are WUI-managed.',
        security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } },
            },
          },
        },
        responses: {
          200: { description: 'Renamed.', content: { 'application/json': { schema: { $ref: '#/components/schemas/Ok' } } } },
          400: { $ref: '#/components/responses/BadRequest' },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { $ref: '#/components/responses/Forbidden' },
          404: { $ref: '#/components/responses/NotFound' },
        },
      },
      delete: {
        tags: ['ApiKeys'],
        summary: 'Revoke an API key (soft delete). Session or admin key (client keys only).',
        description: 'Sets `revoked_at = now()`. The row is preserved so `files.api_key_id` references stay resolvable. Revoked keys 401 on subsequent requests. Admin-key callers can revoke CLIENT keys only — revoking an admin key (including your own) returns 403; admin keys are WUI-managed.',
        security: [{ cookieAuth: [] }, { apiKeyAuth: [] }],
        responses: {
          200: { description: 'Revoked.', content: { 'application/json': { schema: { $ref: '#/components/schemas/Ok' } } } },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { $ref: '#/components/responses/Forbidden' },
          404: { description: 'Not found or already revoked.', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
  },
};

function makeCoverPath(format, width, height, description) {
  return {
    parameters: [{ $ref: '#/components/parameters/FileId' }],
    post: {
      tags: ['Covers'],
      summary: `Generate a ${width}×${height} ${description}.`,
      description: [
        `Composites a branded overlay onto the source image. The exact layout depends on the client's \`layout\` field in \`src/services/branding.config.js\`:`,
        '',
        `- **Default (real-estate)** — logo, gradient dim, info pills (bedrooms/bathrooms/area), operation + location text. Requires a full \`CoverBody\`. Output dimensions: ${width}×${height} (source is resized cover).`,
        `- **\`layout: "minimal"\`** — logo in a corner + diagonal text watermark only. Body is optional (\`{}\` is fine); accepts \`{position}\` to choose the corner (top-right default, also top-left/bottom-right/bottom-left, or \`"none"\` to skip the logo and apply only the watermark). Source dimensions are preserved (the ${width}×${height} target is skipped).`,
        '',
        `The result is saved as a NEW file in luna under the same client_id. Returns full File for session, FileMinimal for API key.`,
        '',
        `If the client's \`formats\` array does not include \`'${format}'\`, returns 400.`,
        '',
        `Source file must be \`type='image'\`. Rate limited to 30 generations/min per API key (or per IP).`,
      ].join('\n'),
      security: [{ apiKeyAuth: [] }, { cookieAuth: [] }],
      requestBody: {
        required: false,
        content: {
          'application/json': {
            schema: { oneOf: [{ $ref: '#/components/schemas/CoverBody' }, { $ref: '#/components/schemas/MinimalCoverBody' }] },
          },
        },
      },
      responses: {
        201: {
          description: 'Cover generated.',
          content: { 'application/json': { schema: { oneOf: [{ $ref: '#/components/schemas/File' }, { $ref: '#/components/schemas/FileMinimal' }] } } },
        },
        400: { $ref: '#/components/responses/BadRequest' },
        401: { $ref: '#/components/responses/Unauthorized' },
        403: { $ref: '#/components/responses/Forbidden' },
        404: { $ref: '#/components/responses/NotFound' },
        429: { description: 'Rate limit exceeded.', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
      },
    },
  };
}
