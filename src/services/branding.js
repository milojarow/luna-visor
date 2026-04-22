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

let userBrands = {};
try {
  userBrands = require('./branding.config');
} catch {
  // No custom branding configured — every client uses the fallback.
}

function getBranding(clientId) {
  return userBrands[clientId] || fallback;
}

module.exports = { getBranding };
