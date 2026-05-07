// Generic fallback brand — used when no custom config matches a client_id.
// To customize per client (logo, colors, watermark, storage policy), copy
// `branding.config.example.js` to `branding.config.js` and add entries keyed
// by the client's integer id. The config file is gitignored so each
// deployment keeps its own brands local.
const fallback = {
  name: 'CDN',
  logoIcon: '',
  logoWordmark: '',
  watermarkIcon: '',
  watermarkText: '',
  watermarkFont: "'Inter', sans-serif",
  colors: { primary: '#888888', dark: '#555555', accent: '#aaaaaa' },
  formats: ['story', 'cover', 'square'],
};

// Project-wide storage standard: every uploaded image lands as webp unless
// a client overrides it with their own `storagePolicy`. The `-thumb` suffix
// matches what the WUI gallery requests for webp files (gallery.js:54), so
// no frontend branching is needed.
const DEFAULT_IMAGE_POLICY = {
  format: 'webp',
  variants: [
    { suffix: null,    width: 2048, height: 2048, fit: 'inside', quality: 82, effort: 6 },
    { suffix: 'thumb', width: 300,  height: 300,  fit: 'inside', quality: 78, effort: 4 },
  ],
};

let userBrands = {};
try {
  userBrands = require('./branding.config');
} catch {
  // No custom branding configured — every client uses the fallback.
}

function getBranding(clientId) {
  return userBrands[clientId] || fallback;
}

function getImagePolicy(clientId) {
  const brand = getBranding(clientId);
  return brand.storagePolicy || DEFAULT_IMAGE_POLICY;
}

module.exports = { getBranding, getImagePolicy, DEFAULT_IMAGE_POLICY };
