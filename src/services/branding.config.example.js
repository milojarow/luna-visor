// Copy this file to `branding.config.js` (which is gitignored) and customize
// for your own clients.
//
// Each entry is keyed by the client's integer id (primary key in the SQLite
// `clients` table — create clients via the web UI or POST /api/clients first,
// then look up their ids). Every field except `name` is optional; missing
// values fall back to the defaults in `branding.js`.

module.exports = {
  // Example: a real-estate brand used by the cover generator.
  1: {
    name: 'example-real-estate',

    // SVG inner contents rendered top-right on generated covers (logo icon).
    logoIcon: `
      <rect x="0" y="0" width="48" height="48" rx="9" fill="#B8834A"/>
      <rect x="11" y="21" width="26" height="21" rx="2" fill="#F0E8D8"/>
    `,

    // Wordmark SVG placed next to the logo icon.
    logoWordmark: `
      <text y="40" font-family="Georgia, serif" font-size="42">
        <tspan fill="#333333">brand</tspan>
      </text>
    `,

    // Repeated diagonal watermark over the cover's safe zone.
    watermarkIcon: `
      <rect x="0" y="0" width="48" height="48" rx="9" fill="white"/>
    `,
    watermarkText: 'example-real-estate',
    watermarkFont: 'Georgia, serif',

    colors: { primary: '#B8834A', dark: '#6B5943', accent: '#C4956A' },

    // Which cover formats are allowed for this client. Endpoints not listed
    // here return 400. Available: 'story' (1080x1920), 'cover' (1080x1350),
    // 'square' (1080x1080), 'fb' (1080x1080).
    formats: ['story', 'cover', 'square'],
  },

  // Example: a lean brand that only uses storage policy — no cover generation.
  // Uploads are normalized to WebP + 2 downscaled variants; the original
  // encoded/sized file is discarded, saving ~90% storage on typical phone
  // photos.
  2: {
    name: 'example-catalog',
    logoIcon: '',
    logoWordmark: '',
    watermarkIcon: '',
    watermarkText: '',
    colors: { primary: '#888888', dark: '#555555', accent: '#aaaaaa' },
    formats: [], // no cover generation
    storagePolicy: {
      format: 'webp',
      variants: [
        // suffix: null means the file at `{uuid}.webp` (returned as cdn_url).
        { suffix: null,    width: 2048, height: 2048, fit: 'inside', quality: 82, effort: 6 },
        { suffix: 'md',    width: 800,  height: 800,  fit: 'inside', quality: 78, effort: 4 },
        { suffix: 'thumb', width: 300,  height: 300,  fit: 'cover',  quality: 75, effort: 2 },
      ],
    },
  },
};
