// OpenAPI 3.0.3 specification for Luna Visor CDN API.
// Served at GET /api/openapi.json — public, no auth required.
// Bump info.version when the contract changes (SemVer).

module.exports = {
  openapi: '3.0.3',
  info: {
    title: 'Luna Visor CDN API',
    version: '1.0.0',
    description: [
      'CDN manager for solutions45.com. Files uploaded here are stored on disk and served publicly at https://cdn.solutions45.com/{uuid}.{ext}.',
      '',
      '## Authentication',
      '',
      'Two methods, checked in this order:',
      '',
      '1. **`X-API-Key` header** — server-to-server. Each key is bound to a single `client_id` and may upload, replace, delete files owned by that client, and generate covers/overlays. Keys are SHA-256 hashed at rest; the raw value is returned once at creation. Revoked keys (soft-delete) return 401.',
      '2. **Session cookie** (`connect.sid`, HttpOnly, 7-day) — for the WUI admin at https://luna.solutions45.com. Full access to all endpoints.',
      '',
      'Endpoints marked `apiKeyAuth OR cookieAuth` accept either. Endpoints marked `cookieAuth` only return **403** to API-key callers.',
      '',
      '## File storage standard',
      '',
      'Non-ephemeral uploads are normalized: images → WebP (`2048×2048` + `300×300` thumb), videos → MP4 H.264/AAC. SVG, MP3, and `.lottie` are passthrough — bytes preserved, no re-encoding. Ephemeral clients (`is_ephemeral=1`) bypass all transformation and auto-delete after 24h.',
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
    { name: 'Clients', description: 'Logical owners of files. Each API key belongs to exactly one client.' },
    { name: 'Files', description: 'Upload, list, replace, move, copy, delete files. UUIDs are public identifiers.' },
    { name: 'Covers', description: 'Branded Instagram/Facebook images (1080×1920 / 1080×1350 / 1080×1080). Per-client branding registry.' },
    { name: 'Overlay', description: 'Transparent PNG overlays for video compositing (video-forge integration).' },
    { name: 'ApiKeys', description: 'Manage server-to-server credentials. Session-only.' },
  ],

  components: {
    securitySchemes: {
      apiKeyAuth: {
        type: 'apiKey',
        in: 'header',
        name: 'X-API-Key',
        description: 'Server-to-server credential. Scoped to a single client_id. Soft-revocable.',
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
        required: ['id', 'name', 'slug', 'is_ephemeral'],
        properties: {
          id: { type: 'integer', example: 2 },
          name: { type: 'string', example: 'posteacasa' },
          slug: { type: 'string', example: 'posteacasa', description: 'kebab-case lowercased name.' },
          is_ephemeral: { type: 'integer', enum: [0, 1], example: 0, description: '1 = uploads bypass transcoding and auto-delete after 24h.' },
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
        required: ['id', 'name', 'key_preview', 'client_id'],
        properties: {
          id: { type: 'integer', example: 7 },
          name: { type: 'string', example: 'key para posteacasa' },
          key_preview: { type: 'string', example: '4f2a', description: 'Last 4 chars of the raw key, for identification.' },
          client_id: { type: 'integer', example: 2 },
          client_name: { type: 'string', example: 'posteacasa' },
          created_at: { type: 'string', format: 'date-time' },
          revoked_at: { type: 'string', format: 'date-time', nullable: true, description: 'Non-null = soft-deleted; auth lookups skip revoked keys.' },
        },
      },

      ApiKeyCreated: {
        type: 'object',
        required: ['id', 'name', 'key', 'key_preview', 'client_id'],
        description: 'Returned ONCE on creation. The `key` value cannot be retrieved later — store it now.',
        properties: {
          id: { type: 'integer', example: 7 },
          name: { type: 'string', example: 'key para posteacasa' },
          key: { type: 'string', example: 'a1b2c3d4e5f6...64hex', description: 'Raw API key. 64 hex chars (32 bytes). Use as X-API-Key header.' },
          key_preview: { type: 'string', example: '4f2a' },
          client_id: { type: 'integer', example: 2 },
          client_name: { type: 'string', example: 'posteacasa' },
        },
      },

      CoverBody: {
        type: 'object',
        required: ['operation', 'location', 'bedrooms', 'bathrooms', 'area'],
        description: 'Real-estate cover content. Composited as SVG overlay onto the source image. Currently used by client posteacasa (client_id=2).',
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
        summary: 'List all clients with file counts.',
        security: [{ cookieAuth: [] }],
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
        summary: 'Create a new client.',
        description: 'Set `is_ephemeral: true` for temp clients (uploads bypass transcoding and auto-delete after 24h).',
        security: [{ cookieAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name'],
                properties: {
                  name: { type: 'string', example: 'new-client' },
                  is_ephemeral: { type: 'boolean', default: false },
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
        summary: 'Rename a client.',
        security: [{ cookieAuth: [] }],
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
        summary: 'List files, optionally filtered by client.',
        security: [{ cookieAuth: [] }],
        parameters: [
          { name: 'client_id', in: 'query', required: false, schema: { type: 'integer' }, description: 'Filter to a single client.' },
        ],
        responses: {
          200: { description: 'Array of files ordered by created_at DESC.', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/File' } } } } },
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
        security: [{ cookieAuth: [] }],
        responses: {
          200: { description: 'File object.', content: { 'application/json': { schema: { $ref: '#/components/schemas/File' } } } },
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
        summary: 'List all API keys (active first, revoked last).',
        security: [{ cookieAuth: [] }],
        responses: {
          200: { description: 'Array of API keys.', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/ApiKey' } } } } },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { $ref: '#/components/responses/Forbidden' },
        },
      },
      post: {
        tags: ['ApiKeys'],
        summary: 'Create a new API key. Raw key is returned ONCE.',
        security: [{ cookieAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'client_id'],
                properties: {
                  name: { type: 'string', example: 'key para nuevo-cliente' },
                  client_id: { type: 'integer' },
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
        summary: 'Rename an API key.',
        security: [{ cookieAuth: [] }],
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
        summary: 'Revoke an API key (soft delete).',
        description: 'Sets `revoked_at = now()`. The row is preserved so `files.api_key_id` references stay resolvable. Revoked keys 401 on subsequent requests.',
        security: [{ cookieAuth: [] }],
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
        `Composites a branded SVG overlay (logo, watermark, gradient, info pills) onto the source image.`,
        '',
        `The result is saved as a NEW file in luna under the same client_id. Returns full File for session, FileMinimal for API key.`,
        '',
        `Per-client branding lives in \`src/services/branding.config.js\`. If the client's \`formats\` array does not include \`'${format}'\`, returns 400.`,
        '',
        `Source file must be \`type='image'\`. Rate limited to 30 generations/min per API key (or per IP).`,
      ].join('\n'),
      security: [{ apiKeyAuth: [] }, { cookieAuth: [] }],
      requestBody: {
        required: true,
        content: {
          'application/json': { schema: { $ref: '#/components/schemas/CoverBody' } },
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
