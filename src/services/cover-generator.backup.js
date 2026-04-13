const sharp = require('sharp');

const DEFAULT_WIDTH = 1080;
const DEFAULT_HEIGHT = 1920;

// ── SVG Icons ──

const iconBed = `
  <rect x="2" y="13" width="20" height="4" rx="1" fill="none" stroke="white" stroke-width="1.8"/>
  <path d="M2 13V7a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v6" fill="none" stroke="white" stroke-width="1.8"/>
  <rect x="7" y="9" width="5" height="4" rx="2" fill="none" stroke="white" stroke-width="1.5"/>
  <rect x="13" y="9" width="5" height="4" rx="2" fill="none" stroke="white" stroke-width="1.5"/>
  <line x1="3" y1="17" x2="3" y2="20" stroke="white" stroke-width="2" stroke-linecap="round"/>
  <line x1="21" y1="17" x2="21" y2="20" stroke="white" stroke-width="2" stroke-linecap="round"/>
`;

const iconShower = `
  <path d="M6 6v6" stroke="white" stroke-width="1.8" stroke-linecap="round"/>
  <path d="M6 6h8a2 2 0 0 1 2 2v1" stroke="white" stroke-width="1.8" stroke-linecap="round" fill="none"/>
  <circle cx="16" cy="11" r="2.5" fill="none" stroke="white" stroke-width="1.8"/>
  <line x1="14" y1="15" x2="13" y2="19" stroke="white" stroke-width="1.5" stroke-linecap="round"/>
  <line x1="16" y1="14" x2="16" y2="19" stroke="white" stroke-width="1.5" stroke-linecap="round"/>
  <line x1="18" y1="15" x2="19" y2="19" stroke="white" stroke-width="1.5" stroke-linecap="round"/>
`;

const iconArea = `
  <rect x="3" y="3" width="18" height="18" rx="1" fill="none" stroke="white" stroke-width="1.8"/>
  <path d="M3 9h18M9 3v18" fill="none" stroke="white" stroke-width="1.2" opacity="0.5"/>
  <path d="M7 7l4 0M7 7l0 4" fill="none" stroke="white" stroke-width="1.8" stroke-linecap="round"/>
`;

const iconGarage = `
  <path d="M2 20V10l10-7 10 7v10" fill="none" stroke="white" stroke-width="1.8" stroke-linejoin="round"/>
  <rect x="5" y="13" width="14" height="7" rx="1" fill="none" stroke="white" stroke-width="1.5"/>
  <circle cx="8" cy="18" r="1.3" fill="white"/>
  <circle cx="16" cy="18" r="1.3" fill="white"/>
  <rect x="7" y="14.5" width="4" height="2.5" rx="0.8" fill="none" stroke="white" stroke-width="1.2"/>
  <rect x="13" y="14.5" width="4" height="2.5" rx="0.8" fill="none" stroke="white" stroke-width="1.2"/>
`;

const iconGarden = `
  <line x1="12" y1="12" x2="12" y2="21" stroke="white" stroke-width="2" stroke-linecap="round"/>
  <path d="M12 16c-3-1-5-3-4-5" stroke="white" stroke-width="1.5" fill="none" stroke-linecap="round"/>
  <path d="M12 18c3-1 4-3 3-5" stroke="white" stroke-width="1.5" fill="none" stroke-linecap="round"/>
  <circle cx="12" cy="8" r="3" fill="none" stroke="white" stroke-width="1.8"/>
  <circle cx="8.5" cy="10" r="2.5" fill="none" stroke="white" stroke-width="1.5"/>
  <circle cx="15.5" cy="10" r="2.5" fill="none" stroke="white" stroke-width="1.5"/>
  <circle cx="9.5" cy="6.5" r="2.5" fill="none" stroke="white" stroke-width="1.5"/>
  <circle cx="14.5" cy="6.5" r="2.5" fill="none" stroke="white" stroke-width="1.5"/>
  <circle cx="12" cy="8.5" r="1.5" fill="white"/>
`;

const iconTree = `
  <line x1="12" y1="14" x2="12" y2="21" stroke="white" stroke-width="2.2" stroke-linecap="round"/>
  <path d="M12 4 C7 4 4 8 4 11.5 C4 15 7.5 16 12 16 C16.5 16 20 15 20 11.5 C20 8 17 4 12 4z" fill="none" stroke="white" stroke-width="1.8"/>
  <path d="M9 14c-1-2 0-4 1.5-5" stroke="white" stroke-width="1" opacity="0.4" stroke-linecap="round" fill="none"/>
  <path d="M15 13c1-1.5 0.5-3.5-1-5" stroke="white" stroke-width="1" opacity="0.4" stroke-linecap="round" fill="none"/>
`;

const logoIcon = `
  <rect x="0" y="0" width="48" height="48" rx="9" fill="#B8834A"/>
  <rect x="11" y="21" width="26" height="21" rx="2" fill="#F0E8D8"/>
  <polygon points="24,5 37,21 29,21 29,26 19,26 19,21 11,21" fill="#6B5943"/>
  <rect x="19" y="33" width="10" height="9" rx="1" fill="#6B5943"/>
`;

const logoWordmark = `
  <text y="40" font-family="Georgia, serif" font-size="42" letter-spacing="-1">
    <tspan fill="#6B5943">postea</tspan><tspan fill="#B8834A">casa</tspan>
  </text>
`;

// ── Pill builder ──

function pill(icon, value, label) {
  const iconW = 24;
  const padL = 14;
  const padR = 16;
  const gap = 6;
  const valueW = value ? value.length * 15 : 0;
  const labelW = label ? label.length * 8.5 : 0;
  const innerW = iconW + gap + valueW + (value && label ? 4 : 0) + labelW;
  const totalWidth = padL + innerW + padR;

  return {
    width: Math.max(totalWidth, 80),
    svg: (x) => {
      const w = Math.max(totalWidth, 80);
      let textX = padL + iconW + gap;
      let parts = "";
      if (value) {
        parts += `<text x="${textX}" y="33" font-family="'Inter', sans-serif" font-size="22" fill="white" font-weight="600">${value}</text>`;
        textX += valueW + 4;
      }
      if (label) {
        parts += `<text x="${textX}" y="33" font-family="'Inter', sans-serif" font-size="14" fill="rgba(255,255,255,0.55)" font-weight="400">${label}</text>`;
      }
      return `
        <g transform="translate(${x}, 0)">
          <rect width="${w}" height="52" rx="12" fill="rgba(255,255,255,0.18)" />
          <g transform="translate(${padL}, 14)">
            <svg viewBox="0 0 24 24" width="24" height="24">${icon}</svg>
          </g>
          ${parts}
        </g>
      `;
    },
  };
}

function renderRow(pills, gap = 10) {
  let x = 0;
  return pills
    .map((p) => {
      const s = p.svg(x);
      x += p.width + gap;
      return s;
    })
    .join("");
}

// ── Main generator ──

async function generateCover({ sourceBuffer, data, width = DEFAULT_WIDTH, height = DEFAULT_HEIGHT }) {
  const allPills = [
    pill(iconBed, data.bedrooms, "Rec."),
    pill(iconShower, data.bathrooms, "Baños"),
    pill(iconArea, data.area, ""),
  ];
  if (data.amenities?.parking) allPills.push(pill(iconGarage, "", "Cochera"));
  if (data.amenities?.garden) allPills.push(pill(iconGarden, "", "Jardín"));
  if (data.amenities?.trees) allPills.push(pill(iconTree, "", "Árboles"));

  const bottomOffset = 100;

  const svg = `
  <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="rgba(0,0,0,0.1)" />
        <stop offset="45%" stop-color="rgba(0,0,0,0.12)" />
        <stop offset="70%" stop-color="rgba(0,0,0,0.5)" />
        <stop offset="100%" stop-color="rgba(0,0,0,0.9)" />
      </linearGradient>
      <linearGradient id="topgrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="rgba(0,0,0,0.45)" />
        <stop offset="100%" stop-color="rgba(0,0,0,0)" />
      </linearGradient>
    </defs>

    <rect width="${width}" height="${height}" fill="rgba(0,0,0,0.12)" />
    <rect width="${width}" height="${height}" fill="url(#grad)" />
    <rect width="${width}" height="220" fill="url(#topgrad)" />

    <rect x="40" y="36" width="170" height="46" rx="23" fill="#C4956A" />
    <text x="125" y="66" font-family="'Inter', sans-serif" font-size="21" font-weight="600" fill="white" text-anchor="middle">En ${data.operation?.includes("Renta") ? "Renta" : "Venta"}</text>

    <g transform="translate(${width - 280}, 30)">
      <svg viewBox="0 0 48 48" width="40" height="40">${logoIcon}</svg>
      <g transform="translate(48, 0)">
        <svg viewBox="0 0 300 52" width="220" height="40">${logoWordmark}</svg>
      </g>
    </g>

    <text x="56" y="${height - bottomOffset - 60}" font-family="'Inter', sans-serif" font-size="52" font-weight="300" fill="white" letter-spacing="0.5">${data.operation}</text>
    <rect x="56" y="${height - bottomOffset - 38}" width="140" height="3" rx="1.5" fill="#C4956A" />

    <g transform="translate(56, ${height - bottomOffset - 5})">
      <svg viewBox="0 0 24 24" width="22" height="22" y="-16">
        <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" fill="none" stroke="rgba(255,255,255,0.8)" stroke-width="1.8"/>
        <circle cx="12" cy="9" r="2.5" fill="rgba(255,255,255,0.8)"/>
      </svg>
      <text x="30" y="0" font-family="'Inter', sans-serif" font-size="26" fill="rgba(255,255,255,0.85)" font-weight="400">${data.location}</text>
    </g>

    <g transform="translate(40, ${height - 80})">
      ${renderRow(allPills)}
    </g>
  </svg>
  `;

  return sharp(sourceBuffer)
    .resize(width, height, { fit: "cover", position: "centre" })
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .jpeg({ quality: 95 })
    .toBuffer();
}

module.exports = { generateCover };
