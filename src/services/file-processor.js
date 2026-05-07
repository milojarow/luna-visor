const fs = require('fs');
const sharp = require('sharp');
const { execFile } = require('child_process');
const path = require('path');
const config = require('../config');

async function processImageWithPolicy(inputPath, uuid, policy, options = {}) {
  const outputDir = config.MEDIA_FILES_PATH;
  const ext = policy.format;
  let fullSize = 0;

  for (const v of policy.variants) {
    const suffix = v.suffix ? `-${v.suffix}` : '';
    const outputPath = path.join(outputDir, `${uuid}${suffix}.${ext}`);

    const resizeOpts = { withoutEnlargement: true };
    const resizeConfig = v.fit === 'cover'
      ? { fit: 'cover', position: 'centre', ...resizeOpts }
      : { fit: 'inside', ...resizeOpts };

    const sharpOpts = options.animated ? { animated: true } : {};
    let pipeline = sharp(inputPath, sharpOpts)
      .rotate()
      .resize(v.width, v.height, resizeConfig);

    if (ext === 'webp') {
      pipeline = pipeline.webp({ quality: v.quality, effort: v.effort });
    }

    const info = await pipeline.toFile(outputPath);
    if (!v.suffix) fullSize = info.size;
  }

  return { extension: ext, mimeType: `image/${ext}`, size: fullSize };
}

function convertVideoToMp4(inputPath, uuid) {
  return new Promise((resolve, reject) => {
    const outputPath = path.join(config.MEDIA_FILES_PATH, `${uuid}.mp4`);
    execFile('ffmpeg', [
      '-i', inputPath,
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '23',
      '-c:a', 'aac', '-b:a', '128k',
      '-movflags', '+faststart',
      '-y', outputPath,
    ], (error) => {
      if (error) return reject(error);
      const size = fs.statSync(outputPath).size;
      resolve({ outputPath, size });
    });
  });
}

function extractThumbnail(inputPath, uuid) {
  return new Promise((resolve, reject) => {
    const outputPath = path.join(config.MEDIA_FILES_PATH, `${uuid}-thumb.jpg`);
    execFile('ffmpeg', [
      '-i', inputPath,
      '-ss', '1',
      '-vframes', '1',
      '-vf', 'scale=300:-1',
      '-y',
      outputPath,
    ], (error) => {
      if (error) reject(error);
      else resolve(outputPath);
    });
  });
}

module.exports = { processImageWithPolicy, convertVideoToMp4, extractThumbnail };
