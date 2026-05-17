const db = require('../db/connection');
const { deleteFile } = require('./file-manager');

function expireOldFiles() {
  const expired = db.prepare(`
    SELECT f.id FROM files f
    JOIN clients c ON c.id = f.client_id
    WHERE c.is_ephemeral = 1
      AND f.created_at < datetime('now', '-24 hours')
  `).all();

  if (expired.length === 0) return 0;

  let deleted = 0;
  for (const { id } of expired) {
    try {
      deleteFile(id);
      deleted++;
    } catch (err) {
      console.error(`[file-expirer] failed to delete ${id}:`, err.message);
    }
  }
  console.log(`[file-expirer] deleted ${deleted}/${expired.length} expired files`);
  return deleted;
}

let interval = null;

function startFileExpirer(intervalMs) {
  try { expireOldFiles(); } catch (err) {
    console.error('[file-expirer] initial run failed:', err.message);
  }
  interval = setInterval(() => {
    try { expireOldFiles(); } catch (err) {
      console.error('[file-expirer] tick failed:', err.message);
    }
  }, intervalMs);
}

function stopFileExpirer() {
  if (interval) clearInterval(interval);
}

module.exports = { expireOldFiles, startFileExpirer, stopFileExpirer };
