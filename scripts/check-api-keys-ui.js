// Optional browser QA: NODE_PATH=/path/to/playwright/node_modules node scripts/check-api-keys-ui.js
// No login, real key data or production mutations. Uses actual renderList + CSS
// with explicitly synthetic metadata. --base-url reads deployed static assets.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const root = path.resolve(__dirname, '..');
const output = process.env.SCRATCHPAD || process.env.TMPDIR;
assert.ok(output, 'Set SCRATCHPAD or TMPDIR for screenshots');
const base = process.argv.includes('--base-url') ? process.argv[process.argv.indexOf('--base-url') + 1] : null;
async function asset(relative) {
  const local = fs.readFileSync(path.join(root, 'public', relative), 'utf8');
  if (!base) return local;
  const res = await fetch(`${base}/${relative}`);
  assert.equal(res.status, 200);
  const deployed = await res.text();
  assert.equal(deployed, local, `deployed ${relative} differs from checkout`);
  return deployed;
}
(async () => {
  fs.mkdirSync(output, { recursive: true });
  const css = await asset('css/style.css');
  const js = await asset('js/api-keys.js');
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setContent('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><main style="padding:24px;max-width:960px;margin:auto"><h1 style="font-size:22px;margin-bottom:8px">API Keys</h1><p style="font-size:13px;margin-bottom:20px">QA · Datos sintéticos · Sin credenciales reales</p><div id="api-keys-list" class="api-keys-list"></div></main></body></html>');
    await page.addStyleTag({ content: css });
    await page.addScriptTag({ content: `const App = { clients: [{id:1,name:'Cliente de muestra'}] }; function clientFlagIcons(){return ''} ${js}\nwindow.qa = ApiKeysPage;` });
    await page.evaluate(() => {
      qa.listEl = document.getElementById('api-keys-list');
      qa.keys = [
        { id: 1, name: 'Orquestador · Administración', is_admin: 1, client_id: null, key_preview: 'demo', created_at: '2026-10-27 00:00:00' },
        { id: 2, name: 'Integración del cliente', is_admin: 0, client_id: 1, client_name: 'Cliente de muestra', key_preview: 'demo', created_at: '2026-10-27 00:00:00' },
        { id: 3, name: 'Administrador retirado', is_admin: 1, client_id: null, key_preview: 'demo', created_at: '2026-10-01 00:00:00', revoked_at: '2026-10-26 00:00:00' },
      ];
      qa.promptRename = key => window.lastAction = `rename:${key.id}`;
      qa.confirmDelete = key => window.lastAction = `revoke:${key.id}`;
      qa.renderList();
    });
    const active = page.locator('[data-id="1"]');
    const normal = page.locator('[data-id="2"]');
    const revoked = page.locator('[data-id="3"]');
    assert.equal(await active.locator('.api-key-active-badge').innerText(), 'Active');
    assert.equal(await normal.evaluate(el => el.classList.contains('api-key-row-admin')), false);
    assert.equal(await revoked.locator('button').count(), 0);
    assert.ok((await revoked.textContent()).includes('Revoked'));
    assert.ok((await active.evaluate(el => getComputedStyle(el).backgroundImage)).includes('linear-gradient'));
    assert.equal(await normal.evaluate(el => getComputedStyle(el).backgroundImage), 'none');
    await active.hover();
    assert.ok((await active.evaluate(el => getComputedStyle(el).backgroundImage)).includes('linear-gradient'));
    await active.locator('[data-action="rename"]').click();
    assert.equal(await page.evaluate(() => window.lastAction), 'rename:1');
    await normal.locator('[data-action="delete"]').click();
    assert.equal(await page.evaluate(() => window.lastAction), 'revoke:2');
    await active.locator('[data-action="rename"]').focus();
    await page.keyboard.press('Tab');
    assert.equal(await active.locator('[data-action="delete"]').evaluate(el => getComputedStyle(el).outlineStyle), 'solid');
    for (const [label, width, height] of [['desktop', 1000, 460], ['mobile', 390, 680]]) {
      await page.setViewportSize({ width, height });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${label}: horizontal overflow`);
      for (const row of [active, normal, revoked]) {
        const box = await row.boundingBox();
        assert.ok(box.width > 100 && box.x >= 0 && box.x + box.width <= width);
      }
      await page.screenshot({ path: path.join(output, `api-keys-${label}.png`), fullPage: true });
    }
    // Alternate surrounding palette: gold remains legible; normal follows theme.
    await page.addStyleTag({ content: ':root{--bg:#fff;--bg-surface:#fafafa;--text:#202020;--text-muted:#555;--card-bg:#eee}' });
    assert.equal(await active.evaluate(el => getComputedStyle(el).color), 'rgb(48, 32, 10)');
    await page.mouse.move(0, 0);
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-id="2"]')).backgroundColor === 'rgb(238, 238, 238)');
    assert.equal(await normal.evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(238, 238, 238)');
    assert.deepEqual(errors, []);
    // WCAG text contrast against every metallic gradient stop (no mental math).
    const luminance = hex => {
      const rgb = hex.match(/../g).map(h => parseInt(h, 16) / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
      return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
    };
    const ratios = ['30200a','16300d','4f1010'].flatMap(fg => ['bb8c3e','e3c77f','fff0bd','d5ad59','f0d998','c59745'].map(bg => (luminance(bg) + 0.05) / (luminance(fg) + 0.05)));
    assert.ok(Math.min(...ratios) >= 4.5);
    console.log(JSON.stringify({ source: base || 'local checkout', syntheticData: true, desktop: '1000x460', mobile: '390x680', actions: 'rename/revoke callbacks verified without API writes', states: 'active/revoked, admin/normal', minMetadataContrast: Math.min(...ratios), cssSha256: crypto.createHash('sha256').update(css).digest('hex'), jsSha256: crypto.createHash('sha256').update(js).digest('hex'), screenshots: ['api-keys-desktop.png','api-keys-mobile.png'], pageErrors: errors }, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
