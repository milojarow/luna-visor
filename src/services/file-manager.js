const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/connection');
const config = require('../config');
const { processImageWithPolicy, convertVideoToMp4, extractThumbnail } = require('./file-processor');
const { getImagePolicy } = require('./branding');

const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'heic', 'heif']);
const VIDEO_EXTS = new Set(['mp4', 'mov', 'webm', 'mkv']);
const AUDIO_EXTS = new Set(['mp3']);
const VECTOR_EXTS = new Set(['svg']);
const RE_ENCODED_EXTS = new Set([...IMAGE_EXTS, ...VIDEO_EXTS]);

function getFileType(ext) {
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (VIDEO_EXTS.has(ext)) return 'video';
  if (AUDIO_EXTS.has(ext)) return 'audio';
  if (VECTOR_EXTS.has(ext)) return 'vector';
  return null;
}

function stripReEncodedExtension(originalName) {
  const ext = path.extname(originalName).slice(1).toLowerCase();
  if (RE_ENCODED_EXTS.has(ext)) {
    return originalName.slice(0, -(ext.length + 1));
  }
  return originalName;
}

async function processUpload(tempPath, ext, type, uuid, clientId) {
  let finalExt = ext;
  let finalMimeType = '';
  let finalSize = 0;
  let hasResized = 0;
  let hasThumbnail = 0;

  if (type === 'image') {
    const policy = getImagePolicy(clientId);
    const result = await processImageWithPolicy(tempPath, uuid, policy, { animated: ext === 'gif' });
    finalExt = result.extension;
    finalMimeType = result.mimeType;
    finalSize = result.size;
    hasResized = 1;
  } else if (type === 'video') {
    let videoPath;
    if (ext === 'mp4') {
      videoPath = path.join(config.MEDIA_FILES_PATH, `${uuid}.mp4`);
      fs.copyFileSync(tempPath, videoPath);
      finalSize = fs.statSync(videoPath).size;
    } else {
      const { outputPath, size } = await convertVideoToMp4(tempPath, uuid);
      videoPath = outputPath;
      finalSize = size;
    }
    finalExt = 'mp4';
    finalMimeType = 'video/mp4';
    try {
      await extractThumbnail(videoPath, uuid);
      hasThumbnail = 1;
    } catch (err) {
      console.error(`Thumbnail extraction failed for ${uuid}:`, err.message);
    }
  } else if (type === 'audio') {
    const destPath = path.join(config.MEDIA_FILES_PATH, `${uuid}.${ext}`);
    fs.copyFileSync(tempPath, destPath);
    finalMimeType = 'audio/mpeg';
    finalSize = fs.statSync(destPath).size;
  } else if (type === 'vector') {
    const destPath = path.join(config.MEDIA_FILES_PATH, `${uuid}.svg`);
    fs.copyFileSync(tempPath, destPath);
    finalExt = 'svg';
    finalMimeType = 'image/svg+xml';
    finalSize = fs.statSync(destPath).size;
  } else {
    throw new Error(`Unexpected file type after validation: ${type}`);
  }

  return { finalExt, finalMimeType, finalSize, hasResized, hasThumbnail };
}

async function saveFile(tempPath, originalName, mimeType, sizeBytes, clientId) {
  const ext = path.extname(originalName).slice(1).toLowerCase();
  const type = getFileType(ext);
  if (!type) {
    try { fs.unlinkSync(tempPath); } catch {}
    throw new Error(`File extension ".${ext}" not allowed`);
  }
  const uuid = uuidv4();

  let processed;
  try {
    processed = await processUpload(tempPath, ext, type, uuid, clientId);
  } finally {
    try { fs.unlinkSync(tempPath); } catch {}
  }

  const mime = processed.finalMimeType || mimeType;

  db.prepare(`
    INSERT INTO files (id, original_name, extension, mime_type, size_bytes, client_id, type, has_thumbnail, has_resized)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(uuid, stripReEncodedExtension(originalName), processed.finalExt, mime, processed.finalSize, clientId, type, processed.hasThumbnail, processed.hasResized);

  return db.prepare('SELECT * FROM files WHERE id = ?').get(uuid);
}

function deleteFile(fileId) {
  const file = db.prepare('SELECT * FROM files WHERE id = ?').get(fileId);
  if (!file) return null;

  const matches = fs.readdirSync(config.MEDIA_FILES_PATH).filter(f => f.startsWith(fileId));
  for (const f of matches) {
    try { fs.unlinkSync(path.join(config.MEDIA_FILES_PATH, f)); } catch {}
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
  const matches = fs.readdirSync(config.MEDIA_FILES_PATH).filter(f => f.startsWith(fileId));
  for (const f of matches) {
    const dst = f.replace(fileId, newUuid);
    try {
      fs.copyFileSync(
        path.join(config.MEDIA_FILES_PATH, f),
        path.join(config.MEDIA_FILES_PATH, dst),
      );
    } catch {}
  }

  db.prepare(`
    INSERT INTO files (id, original_name, extension, mime_type, size_bytes, client_id, type, has_thumbnail, has_resized)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(newUuid, file.original_name, file.extension, file.mime_type, file.size_bytes, targetClientId, file.type, file.has_thumbnail, file.has_resized);

  return db.prepare('SELECT * FROM files WHERE id = ?').get(newUuid);
}

async function replaceFile(fileId, tempPath, originalName, mimeType, sizeBytes) {
  const existing = db.prepare('SELECT * FROM files WHERE id = ?').get(fileId);
  if (!existing) return null;

  // Clean all physical files for this UUID (original + any variant, any scheme)
  const matches = fs.readdirSync(config.MEDIA_FILES_PATH).filter(f => f.startsWith(fileId));
  for (const f of matches) {
    try { fs.unlinkSync(path.join(config.MEDIA_FILES_PATH, f)); } catch {}
  }

  const ext = path.extname(originalName).slice(1).toLowerCase();
  const type = getFileType(ext);
  if (!type) {
    try { fs.unlinkSync(tempPath); } catch {}
    throw new Error(`File extension ".${ext}" not allowed`);
  }

  let processed;
  try {
    processed = await processUpload(tempPath, ext, type, fileId, existing.client_id);
  } finally {
    try { fs.unlinkSync(tempPath); } catch {}
  }

  const mime = processed.finalMimeType || mimeType;

  db.prepare(`
    UPDATE files SET original_name = ?, extension = ?, mime_type = ?, size_bytes = ?,
    type = ?, has_thumbnail = ?, has_resized = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(stripReEncodedExtension(originalName), processed.finalExt, mime, processed.finalSize, type, processed.hasThumbnail, processed.hasResized, fileId);

  return db.prepare('SELECT * FROM files WHERE id = ?').get(fileId);
}

module.exports = { saveFile, deleteFile, moveFile, copyFile, replaceFile };
