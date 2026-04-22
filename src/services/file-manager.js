const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/connection');
const config = require('../config');
const { processImage, processImageWithPolicy, extractThumbnail } = require('./file-processor');
const { getBranding } = require('./branding');

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

  const brand = getBranding(clientId);
  const policy = brand.storagePolicy;
  const applyPolicy = policy && type === 'image' && ext !== 'gif';

  let finalExt = ext;
  let finalMimeType = mimeType;
  let finalSize = sizeBytes;
  let hasResized = 0;
  let hasThumbnail = 0;

  if (applyPolicy) {
    try {
      const result = await processImageWithPolicy(tempPath, uuid, policy);
      finalExt = result.extension;
      finalMimeType = result.mimeType;
      finalSize = result.size;
      hasResized = 1;
    } catch (err) {
      console.error(`Policy processing failed for ${originalName}, falling back to raw:`, err.message);
      const destPath = path.join(config.MEDIA_FILES_PATH, `${uuid}.${ext}`);
      fs.copyFileSync(tempPath, destPath);
    }
    fs.unlinkSync(tempPath);
  } else {
    const destPath = path.join(config.MEDIA_FILES_PATH, `${uuid}.${ext}`);
    fs.copyFileSync(tempPath, destPath);
    fs.unlinkSync(tempPath);

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
  }

  db.prepare(`
    INSERT INTO files (id, original_name, extension, mime_type, size_bytes, client_id, type, has_thumbnail, has_resized)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(uuid, originalName, finalExt, finalMimeType, finalSize, clientId, type, hasThumbnail, hasResized);

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
  const srcBase = path.join(config.MEDIA_FILES_PATH, fileId);
  const dstBase = path.join(config.MEDIA_FILES_PATH, newUuid);

  const suffixes = ['', '-normal', '-md', '-thumb'];
  for (const suffix of suffixes) {
    // -thumb is jpg for video thumbnails, but same-as-file-ext for policy-generated image thumbs
    const ext = suffix === '-thumb' && file.type === 'video' ? 'jpg' : file.extension;
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

  const brand = getBranding(existing.client_id);
  const policy = brand.storagePolicy;
  const applyPolicy = policy && type === 'image' && ext !== 'gif';

  let finalExt = ext;
  let finalMimeType = mimeType;
  let finalSize = sizeBytes;
  let hasResized = 0;
  let hasThumbnail = 0;

  if (applyPolicy) {
    try {
      const result = await processImageWithPolicy(tempPath, fileId, policy);
      finalExt = result.extension;
      finalMimeType = result.mimeType;
      finalSize = result.size;
      hasResized = 1;
    } catch (err) {
      console.error(`Policy processing failed for ${originalName}, falling back to raw:`, err.message);
      const destPath = path.join(config.MEDIA_FILES_PATH, `${fileId}.${ext}`);
      fs.copyFileSync(tempPath, destPath);
    }
    fs.unlinkSync(tempPath);
  } else {
    const destPath = path.join(config.MEDIA_FILES_PATH, `${fileId}.${ext}`);
    fs.copyFileSync(tempPath, destPath);
    fs.unlinkSync(tempPath);

    if (type === 'image') {
      try {
        await processImage(destPath, fileId, ext);
        hasResized = 1;
      } catch (err) {
        console.error(`Failed to process image ${originalName}:`, err.message);
      }
    } else if (type === 'video') {
      try {
        await extractThumbnail(destPath, fileId);
        hasThumbnail = 1;
      } catch (err) {
        console.error(`Failed to extract thumbnail for ${originalName}:`, err.message);
      }
    }
  }

  db.prepare(`
    UPDATE files SET original_name = ?, extension = ?, mime_type = ?, size_bytes = ?,
    type = ?, has_thumbnail = ?, has_resized = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(originalName, finalExt, finalMimeType, finalSize, type, hasThumbnail, hasResized, fileId);

  return db.prepare('SELECT * FROM files WHERE id = ?').get(fileId);
}

module.exports = { saveFile, deleteFile, moveFile, copyFile, replaceFile };
