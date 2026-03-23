const sharp = require('sharp');
const { execFile } = require('child_process');
const path = require('path');
const config = require('../config');

const IMAGE_SIZES = {
  normal: 300,
  big: 600,
  bigger: 1200,
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

module.exports = { processImage, extractThumbnail, IMAGE_SIZES };
