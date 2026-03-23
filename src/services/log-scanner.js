const fs = require('fs');
const path = require('path');
const config = require('../config');
const db = require('../db/connection');

const OFFSET_FILE = path.join(config.MEDIA_DB_PATH, 'log-scanner-offset.txt');
const SELF_HOSTS = ['luna.solutions45.com', 'cdn.solutions45.com'];

// UUID v4 pattern
const UUID_RE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/;

function getOffset() {
  try {
    return parseInt(fs.readFileSync(OFFSET_FILE, 'utf8').trim(), 10) || 0;
  } catch {
    return 0;
  }
}

function saveOffset(offset) {
  fs.writeFileSync(OFFSET_FILE, String(offset));
}

function extractUuid(uri) {
  // URI looks like /uuid.ext or /uuid-normal.ext or /uuid-thumb.jpg
  const basename = path.basename(uri).split('.')[0]; // strip extension
  // Remove size suffixes
  const cleaned = basename.replace(/-(normal|big|bigger|thumb)$/, '');
  const match = cleaned.match(UUID_RE);
  return match ? match[1] : null;
}

function isExternalReferer(referer) {
  if (!referer) return false;
  try {
    const host = new URL(referer).hostname;
    return !SELF_HOSTS.includes(host);
  } catch {
    return false;
  }
}

function scanReferences() {
  const logPath = config.CDN_ACCESS_LOG;
  if (!fs.existsSync(logPath)) return 0;

  const stat = fs.statSync(logPath);
  const offset = getOffset();
  if (stat.size <= offset) return 0;

  const fd = fs.openSync(logPath, 'r');
  const buf = Buffer.alloc(stat.size - offset);
  fs.readSync(fd, buf, 0, buf.length, offset);
  fs.closeSync(fd);

  const lines = buf.toString('utf8').split('\n').filter(Boolean);
  const referencedUuids = new Set();

  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      const uri = entry.request?.uri || '';
      const referer = entry.request?.headers?.Referer?.[0] || '';

      if (!isExternalReferer(referer)) continue;

      const uuid = extractUuid(uri);
      if (uuid) referencedUuids.add(uuid);
    } catch {
      // Skip malformed lines
    }
  }

  saveOffset(stat.size);

  if (referencedUuids.size === 0) return 0;

  const placeholders = [...referencedUuids].map(() => '?').join(',');
  const result = db.prepare(
    `UPDATE files SET referenced = 1 WHERE id IN (${placeholders}) AND referenced = 0`
  ).run(...referencedUuids);

  return result.changes;
}

let scanInterval = null;

function startPeriodicScan(intervalMs) {
  // Run once immediately
  try { scanReferences(); } catch (err) {
    console.error('Log scan error:', err.message);
  }

  scanInterval = setInterval(() => {
    try { scanReferences(); } catch (err) {
      console.error('Log scan error:', err.message);
    }
  }, intervalMs);
}

function stopPeriodicScan() {
  if (scanInterval) clearInterval(scanInterval);
}

module.exports = { scanReferences, startPeriodicScan, stopPeriodicScan };
