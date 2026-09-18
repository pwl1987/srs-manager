const path = require('path');

module.exports = {
  port: parseInt(process.env.PORT || '3001', 10),
  srsApiUrl: process.env.SRS_API_URL || 'http://host.docker.internal:1985/api/v1',
  srsApiToken: process.env.SRS_API_TOKEN || '',
  srsApiUsername: process.env.SRS_API_USERNAME || '',
  srsApiPassword: process.env.SRS_API_PASSWORD || '',
  adminUser: process.env.ADMIN_USER || 'admin',
  adminPasswordHash: process.env.ADMIN_PASSWORD_HASH || '',
  jwtSecret: process.env.JWT_SECRET || 'dev_secret',
  accessTokenTTL: parseInt(process.env.ACCESS_TOKEN_TTL || '7200', 10),
  refreshTokenTTL: parseInt(process.env.REFRESH_TOKEN_TTL || '604800', 10),
  corsAllowedOrigins: (process.env.CORS_ALLOWED_ORIGINS || 'http://localhost:3001').split(','),
  dbPath: process.env.DB_PATH || path.join(__dirname, '..', 'data', 'stream.db'),
  loginFailLimit: 5,
  loginLockDuration: 15 * 60 * 1000, // 15 minutes in ms
};
