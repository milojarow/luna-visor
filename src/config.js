require('dotenv').config();

const path = require('path');

const required = ['SESSION_SECRET', 'ADMIN_PASSWORD_HASH', 'MEDIA_PATH', 'CDN_BASE_URL'];
for (const key of required) {
  if (!process.env[key]) {
    console.error(`Missing required env var: ${key}`);
    process.exit(1);
  }
}

module.exports = {
  PORT: parseInt(process.env.PORT, 10) || 3000,
  SESSION_SECRET: process.env.SESSION_SECRET,
  ADMIN_PASSWORD_HASH: process.env.ADMIN_PASSWORD_HASH,
  MEDIA_PATH: process.env.MEDIA_PATH,
  MEDIA_FILES_PATH: path.join(process.env.MEDIA_PATH, 'files'),
  MEDIA_DB_PATH: path.join(process.env.MEDIA_PATH, 'db'),
  CDN_BASE_URL: process.env.CDN_BASE_URL.replace(/\/$/, ''),
  LUNA_BASE_URL: process.env.LUNA_BASE_URL ? process.env.LUNA_BASE_URL.replace(/\/$/, '') : null,
  CDN_ACCESS_LOG: process.env.CDN_ACCESS_LOG || '/var/log/caddy/cdn-access.log',
};
