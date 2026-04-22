const sharp = require('sharp');
const { execFile } = require('child_process');
const path = require('path');
const config = require('../config');

const IMAGE_SIZES = {
  normal: 300,
};

async function processImage(inputPath, uuid, ext) {
  const outputDir = config.MEDIA_FILES_PATH;
  const metadata = await sharp(inputPath).metadata();

  for (const [suffix, width] of Object.entries(IMAGE_SIZES)) {
    const outputPath = path.join(outputDir, `${uuid}-${suffix}.${ext}`);
    if (metadata.width > width) {
      await sharp(inputPath)
        .resize(width, null, { withoutEnlargement: true })
        .toFile(outputPath);
    } else {
      await sharp(inputPath).toFile(outputPath);
    }
  }

  return { width: metadata.width, height: metadata.height };
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

async function processImageWithPolicy(inputPath, uuid, policy) {
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

    let pipeline = sharp(inputPath)
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

module.exports = { processImage, processImageWithPolicy, extractThumbnail, IMAGE_SIZES };
