const fs = require('fs');
const path = require('path');

const ALLOWED_EXTS = {
  image: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'heic', 'heif'],
  video: ['mp4', 'mov', 'webm', 'mkv'],
  audio: ['mp3'],
  vector: ['svg'],
  lottie: ['lottie'],
};

const EXT_TO_KIND = Object.fromEntries(
  Object.entries(ALLOWED_EXTS).flatMap(([kind, exts]) => exts.map(e => [e, kind]))
);

const MAGIC_TO_KIND = {
  'image/jpeg': 'image',
  'image/png': 'image',
  'image/gif': 'image',
  'image/webp': 'image',
  'image/avif': 'image',
  'image/heic': 'image',
  'image/heif': 'image',
  'image/heic-sequence': 'image',
  'image/heif-sequence': 'image',
  'video/mp4': 'video',
  'video/quicktime': 'video',
  'video/webm': 'video',
  'video/x-matroska': 'video',
  'audio/mpeg': 'audio',
};

class ValidationError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
    this.name = 'ValidationError';
  }
}

function sanitizeOriginalName(name) {
  let s = path.basename(String(name || '')).normalize('NFC');
  s = s.replace(/[\x00-\x1F\x7F]/g, '');
  if (s.length > 200) s = s.slice(0, 200);
  if (!s.trim()) s = 'unnamed';
  return s;
}

async function detectKind(filePath, ext) {
  if (ext === 'svg') {
    const fd = await fs.promises.open(filePath, 'r');
    try {
      const buf = Buffer.alloc(512);
      await fd.read(buf, 0, 512, 0);
      const head = buf.toString('utf8').trim().toLowerCase();
      if (head.includes('<svg') || head.startsWith('<?xml')) {
        return { kind: 'vector', mime: 'image/svg+xml' };
      }
      throw new ValidationError(400, 'File has .svg extension but content is not SVG XML');
    } finally {
      await fd.close();
    }
  }

  if (ext === 'lottie') {
    const fd = await fs.promises.open(filePath, 'r');
    try {
      const head = Buffer.alloc(4);
      await fd.read(head, 0, 4, 0);
      // dotLottie: ZIP archive (PK\x03\x04)
      if (head[0] === 0x50 && head[1] === 0x4B && head[2] === 0x03 && head[3] === 0x04) {
        return { kind: 'lottie', mime: 'application/zip' };
      }
      // Bodymovin: raw JSON — parse full file to confirm, sanity-check lottie shape
      if (head[0] === 0x7B || head[0] === 0x20 || head[0] === 0x09 || head[0] === 0x0A || head[0] === 0x0D) {
        const full = await fs.promises.readFile(filePath, 'utf8');
        let parsed;
        try { parsed = JSON.parse(full); } catch {
          throw new ValidationError(400, 'File has .lottie extension but JSON content is invalid');
        }
        if (parsed && typeof parsed === 'object' && (parsed.v !== undefined || parsed.layers !== undefined || parsed.assets !== undefined)) {
          return { kind: 'lottie', mime: 'application/json' };
        }
        throw new ValidationError(400, 'File has .lottie extension but JSON does not look like a Lottie animation');
      }
      throw new ValidationError(400, 'File has .lottie extension but content is neither dotLottie ZIP nor Bodymovin JSON');
    } finally {
      await fd.close();
    }
  }

  const { fileTypeFromFile } = await import('file-type');
  const detected = await fileTypeFromFile(filePath);
  if (!detected) {
    throw new ValidationError(400, 'Could not detect file type from contents');
  }
  const kind = MAGIC_TO_KIND[detected.mime];
  if (!kind) {
    throw new ValidationError(400, `File content type "${detected.mime}" is not allowed`);
  }
  return { kind, mime: detected.mime };
}

async function validateUpload(filePath, originalName) {
  const ext = path.extname(String(originalName || '')).slice(1).toLowerCase();
  const declaredKind = EXT_TO_KIND[ext];
  if (!declaredKind) {
    throw new ValidationError(
      400,
      `File extension ".${ext || '(none)'}" not allowed. Allowed: image (jpg/png/webp/gif/avif/heic), video (mp4/mov/webm/mkv), audio (mp3), vector (svg), lottie (.lottie).`
    );
  }
  const { kind: actualKind, mime } = await detectKind(filePath, ext);
  if (actualKind !== declaredKind) {
    throw new ValidationError(
      400,
      `File content category "${actualKind}" doesn't match extension category ".${ext}" → "${declaredKind}"`
    );
  }
  return { ext, kind: actualKind, mime };
}

module.exports = {
  validateUpload,
  sanitizeOriginalName,
  ValidationError,
  ALLOWED_EXTS,
  EXT_TO_KIND,
};
