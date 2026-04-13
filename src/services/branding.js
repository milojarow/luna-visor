const brands = {
  2: {
    name: 'posteacasa',
    logoIcon: `
      <rect x="0" y="0" width="48" height="48" rx="9" fill="#B8834A"/>
      <rect x="11" y="21" width="26" height="21" rx="2" fill="#F0E8D8"/>
      <polygon points="24,5 37,21 29,21 29,26 19,26 19,21 11,21" fill="#6B5943"/>
      <rect x="19" y="33" width="10" height="9" rx="1" fill="#6B5943"/>
    `,
    logoWordmark: `
      <text y="40" font-family="Georgia, serif" font-size="42" letter-spacing="-1">
        <tspan fill="#6B5943">postea</tspan><tspan fill="#B8834A">casa</tspan>
      </text>
    `,
    watermarkIcon: `
      <rect x="0" y="0" width="48" height="48" rx="9" fill="white"/>
      <rect x="11" y="21" width="26" height="21" rx="2" fill="rgba(0,0,0,0.3)"/>
      <polygon points="24,5 37,21 29,21 29,26 19,26 19,21 11,21" fill="rgba(0,0,0,0.4)"/>
      <rect x="19" y="33" width="10" height="9" rx="1" fill="rgba(0,0,0,0.4)"/>
    `,
    watermarkText: 'posteacasa',
    watermarkFont: 'Georgia, serif',
    colors: { primary: '#B8834A', dark: '#6B5943', accent: '#C4956A' },
    formats: ['story', 'cover', 'square'],
  },
  // 1: blindando — added when branding assets are ready
};

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

function getBranding(clientId) {
  return brands[clientId] || fallback;
}

module.exports = { getBranding };
