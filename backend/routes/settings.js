const express = require('express');
const jwtAuth = require('../middleware/jwt-auth');
const router = express.Router();
const settingsService = require('../services/settings-service');
const srsService = require('../services/srs');
router.use(jwtAuth);

router.get('/', (req, res) => {
  res.json(settingsService.getAllSettings());
});

router.get('/srs-config', (req, res) => {
  res.json(settingsService.getSrsConfig());
});

router.get('/ntp-status', (req, res) => {
  res.json(settingsService.getNtpStatus());
});

// Connectivity check against the configured SRS API.
router.get('/test-srs', async (req, res) => {
  try {
    const version = await srsService.getVersion();
    res.json({ ok: true, version: version?.version || null, data: version });
  } catch (err) {
    res.status(502).json({ ok: false, code: 'INTERNAL_VERIFICATION_FAILED', error: `SRS API unreachable: ${err.message}` });
  }
});

router.put('/', (req, res) => {
  const updates = {};
  for (const [key, value] of Object.entries(req.body)) {
    if (!settingsService.SETTABLE_KEYS.includes(key)) {
      return res.status(400).json({ code: 'VALIDATION_TEMPLATE_INVALID', error: `Unknown setting key: ${key}`, detail: `Allowed keys: ${settingsService.SETTABLE_KEYS.join(', ')}` });
    }
    updates[key] = value;
  }
  if (updates.srs_api_url !== undefined) {
    try {
      const parsed = new URL(updates.srs_api_url);
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('protocol must be http/https');
    } catch {
      return res.status(400).json({ code: 'VALIDATION_TEMPLATE_INVALID', error: 'srs_api_url must be a valid http(s) URL' });
    }
  }
  if (updates.srs_rtmp_port !== undefined) {
    const port = parseInt(updates.srs_rtmp_port, 10);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      return res.status(400).json({ code: 'VALIDATION_TEMPLATE_INVALID', error: 'srs_rtmp_port must be an integer between 1 and 65535' });
    }
  }
  for (const [key, value] of Object.entries(updates)) {
    settingsService.setSetting(key, value);
  }
  res.json(updates);
});

module.exports = router;
