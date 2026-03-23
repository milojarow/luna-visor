const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/connection');
const config = require('../config');
const { processImage, extractThumbnail } = require('./file-processor');

const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif']);
const VIDEO_EXTS = new Set(['mp4', 'mov', 'webm', 'mkv']);

function getFileType(ext) {
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (VIDEO_EXTS.has(ext)) return 'video';
  return 'other';
}

async function saveFile(tempPath, originalName, mimeType, sizeBytes, clientId) {
  const ext = path.extname(originalName).slice(1).toLowerCase();
  const uuid = uuidv4();
  const type = getFileType(ext);
  const destPath = path.join(config.MEDIA_FILES_PATH, `${uuid}.${ext}`);

  fs.copyFileSync(tempPath, destPath);
  fs.unlinkSync(tempPath);

  let hasResized = 0;
  let hasThumbnail = 0;

  if (type === 'image') {
    try {
      await processImage(destPath, uuid, ext);
      hasResized = 1;
    } catch (err) {
      console.error(`Failed to process image ${originalName}:`, err.message);
    }
  } else if (type === 'video') {
    try {
      await extractThumbnail(destPath, uuid);
      hasThumbnail = 1;
    } catch (err) {
      console.error(`Failed to extract thumbnail for ${originalName}:`, err.message);
    }
  }

  db.prepare(`
    INSERT INTO files (id, original_name, extension, mime_type, size_bytes, client_id, type, has_thumbnail, has_resized)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(uuid, originalName, ext, mimeType, sizeBytes, clientId, type, hasThumbnail, hasResized);

  return db.prepare('SELECT * FROM files WHERE id = ?').get(uuid);
}

function deleteFile(fileId) {
  const file = db.prepare('SELECT * FROM files WHERE id = ?').get(fileId);
  if (!file) return null;

  const base = path.join(config.MEDIA_FILES_PATH, fileId);
  const patterns = [
    `${base}.${file.extension}`,
    `${base}-normal.${file.extension}`,
    `${base}-big.${file.extension}`,
    `${base}-bigger.${file.extension}`,
    `${base}-thumb.jpg`,
  ];

  for (const p of patterns) {
    try { fs.unlinkSync(p); } catch {}
  }

  db.prepare('DELETE FROM files WHERE id = ?').run(fileId);
  return file;
}

function moveFile(fileId, targetClientId) {
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(targetClientId);
  if (!client) return null;

  const result = db.prepare('UPDATE files SET client_id = ?, updated_at = datetime(\'now\') WHERE id = ?')
    .run(targetClientId, fileId);
  if (result.changes === 0) return null;

  return db.prepare('SELECT * FROM files WHERE id = ?').get(fileId);
}

async function copyFile(fileId, targetClientId) {
  const file = db.prepare('SELECT * FROM files WHERE id = ?').get(fileId);
  if (!file) return null;

  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(targetClientId);
  if (!client) return null;

  const newUuid = uuidv4();
  const srcBase = path.join(config.MEDIA_FILES_PATH, fileId);
  const dstBase = path.join(config.MEDIA_FILES_PATH, newUuid);

  const suffixes = ['', '-normal', '-big', '-bigger', '-thumb'];
  for (const suffix of suffixes) {
    const ext = suffix === '-thumb' ? 'jpg' : file.extension;
    const src = `${srcBase}${suffix}.${ext}`;
    const dst = `${dstBase}${suffix}.${ext}`;
    try {
      fs.copyFileSync(src, dst);
    } catch {}
  }

  db.prepare(`
    INSERT INTO files (id, original_name, extension, mime_type, size_bytes, client_id, type, has_thumbnail, has_resized)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(newUuid, file.original_name, file.extension, file.mime_type, file.size_bytes, targetClientId, file.type, file.has_thumbnail, file.has_resized);

  return db.prepare('SELECT * FROM files WHERE id = ?').get(newUuid);
}

module.exports = { saveFile, deleteFile, moveFile, copyFile };
