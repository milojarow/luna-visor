#!/usr/bin/env node
// Partner administration. There is no WUI for this — the "socio" badge on the
// API Keys page is the owner's visibility; this is the lever.
//
//   node scripts/partners.js list
//   node scripts/partners.js create richie 'password' 'Richie'
//   node scripts/partners.js grant richie 69
const bcrypt = require('bcrypt');
const db = require('../src/db/connection');

const [, , cmd, ...args] = process.argv;

function die(msg) { console.error(msg); process.exit(1); }

const commands = {
  list() {
    const partners = db.prepare('SELECT * FROM partners ORDER BY id').all();
    if (!partners.length) return console.log('(no hay socios)');
    for (const p of partners) {
      const state = p.disabled_at ? `DESHABILITADO ${p.disabled_at}` : 'activo';
      console.log(`#${p.id} ${p.name} (${p.display_name || '—'}) — ${state}`);
      const vaults = db.prepare(`
        SELECT k.id, k.name, c.name AS client, k.revoked_at
        FROM api_keys k LEFT JOIN clients c ON c.id = k.client_id
        WHERE k.partner_id = ? ORDER BY k.id
      `).all(p.id);
      for (const v of vaults) {
        console.log(`    key #${v.id} → ${v.client || 'ADMIN'}${v.revoked_at ? '  [revocada]' : ''}  "${v.name}"`);
      }
      if (!vaults.length) console.log('    (sin bóvedas)');
    }
  },

  create(name, password, display) {
    if (!name || !password) die("uso: create <name> <password> ['Display Name']");
    const id = db.prepare('INSERT INTO partners (name, display_name, password_hash) VALUES (?, ?, ?)')
      .run(name, display || null, bcrypt.hashSync(password, 12)).lastInsertRowid;
    console.log(`socio #${id} ${name} creado`);
  },

  passwd(name, password) {
    if (!name || !password) die('uso: passwd <name> <password>');
    const r = db.prepare('UPDATE partners SET password_hash = ? WHERE name = ?')
      .run(bcrypt.hashSync(password, 12), name);
    console.log(r.changes ? `contraseña de ${name} rotada` : `no existe el socio ${name}`);
  },

  disable(name) {
    const r = db.prepare("UPDATE partners SET disabled_at = datetime('now') WHERE name = ?").run(name);
    console.log(r.changes ? `${name} deshabilitado` : `no existe el socio ${name}`);
  },

  enable(name) {
    const r = db.prepare('UPDATE partners SET disabled_at = NULL WHERE name = ?').run(name);
    console.log(r.changes ? `${name} habilitado` : `no existe el socio ${name}`);
  },

  grant(name, keyId) {
    const p = db.prepare('SELECT id FROM partners WHERE name = ?').get(name);
    if (!p) die(`no existe el socio ${name}`);
    const k = db.prepare('SELECT id, is_admin, revoked_at, client_id FROM api_keys WHERE id = ?').get(keyId);
    if (!k) die(`no existe la key #${keyId}`);
    // An admin key hung on a partner would be catastrophic. The scope query
    // filters is_admin=0 too, but refusing here is where it is legible.
    if (k.is_admin) die('esa es una ADMIN key — jamás se cuelga a un socio');
    if (k.revoked_at) die('esa key está revocada — mintea una nueva');
    db.prepare('UPDATE api_keys SET partner_id = ? WHERE id = ?').run(p.id, k.id);
    console.log(`key #${k.id} (client ${k.client_id}) colgada a ${name}`);
  },

  ungrant(keyId) {
    const r = db.prepare('UPDATE api_keys SET partner_id = NULL WHERE id = ?').run(keyId);
    console.log(r.changes ? `key #${keyId} despegada` : `no existe la key #${keyId}`);
  },
};

if (!commands[cmd]) die(`uso: node scripts/partners.js <${Object.keys(commands).join('|')}>`);
commands[cmd](...args);
