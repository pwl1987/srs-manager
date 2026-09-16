const express = require('express');
const router = express.Router();
const settingsService = require('../services/settings-service');

router.get('/', (req, res) => {
  res.json(settingsService.getAllSettings());
});

router.get('/srs-config', (req, res) => {
  res.json(settingsService.getSrsConfig());
});

router.get('/ntp-status', (req, res) => {
  res.json(settingsService.getNtpStatus());
});

router.put('/:key', (req, res) => {
  settingsService.setSetting(req.params.key, req.body.value);
  res.json({ key: req.params.key, value: req.body.value });
});

module.exports = router;
