const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');
const config = require('./config');
const db = require('./database');

// Middleware
const app = express();
app.use(cors({ origin: config.corsAllowedOrigins }));
app.use(express.json());
app.use(cookieParser());
// Exposes req.refreshToken from the httpOnly cookie for /api/auth/refresh and /logout.
app.use(require('./middleware/refresh-token'));

// Health check
app.get('/api/health', (req, res) => {
  try {
    db.prepare('SELECT 1').get();
    res.json({ status: 'ok', uptime: process.uptime() });
  } catch (err) {
    res.status(500).json({ status: 'error', error: err.message });
  }
});

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/streams', require('./routes/streams'));
app.use('/api/v3', require('./routes/v3'));
app.use('/api/preview', require('./routes/preview'));
app.use('/api/cdn/channels', require('./routes/cdn-channels'));
app.use('/api/cdn/auth-config', require('./routes/cdn-auth'));
app.use('/api/dns/auth', require('./routes/dns-auth'));
app.use('/api/dns/records', require('./routes/dns-records'));
app.use('/api/keys', require('./routes/keys'));
app.use('/api/distribution', require('./routes/distribution'));
app.use('/api/external-sources', require('./routes/external-sources'));
app.use('/api/pull-tasks', require('./routes/pull-tasks'));
app.use('/api/forward-tasks', require('./routes/forward-tasks'));
app.use('/api/forward', require('./routes/forward'));
app.use('/api/out-pull', require('./routes/out-pull'));
app.use('/api/monitor', require('./routes/monitor'));
app.use('/api/transcode-templates', require('./routes/transcode-templates'));
app.use('/api/transcode-bindings', require('./routes/transcode-bindings'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/hooks', require('./routes/hooks'));

// Static files (frontend build)
const publicPath = path.join(__dirname, 'public');
if (require('fs').existsSync(publicPath)) {
  // No-cache for index.html so browsers fetch the fresh entry after deploys.
  // Hashed JS/CSS assets remain cacheable via express.static.
  app.use((req, res, next) => {
    if (req.path === '/' || req.path === '/index.html') {
      res.set('Cache-Control', 'no-cache');
    }
    next();
  });
  app.use(express.static(publicPath));
  app.get('*', (req, res) => {
    res.set('Cache-Control', 'no-cache');
    res.sendFile(path.join(publicPath, 'index.html'));
  });
}

// Error handler
app.use((err, req, res, next) => {
  console.error('[Server Error]', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Background tasks
const distributionService = require('./services/distribution-service');
setInterval(() => {
  distributionService.checkExpiredRequests();
}, 5 * 60 * 1000);

// Start server
app.listen(config.port, '0.0.0.0', () => {
  console.log(`[SRS Manager] Server running on port ${config.port}`);
  console.log(`[SRS Manager] SRS API: ${config.srsApiUrl}`);
  console.log(`[SRS Manager] Database: ${config.dbPath}`);
});
