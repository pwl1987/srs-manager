const express = require('express');
const router = express.Router();
const forwardService = require('../services/forward-service');

// SRS Forward backend API - no JWT auth required (called by SRS).
// SRS backend convention: {"code": 0, "urls": [...]}; "targets" kept for older consumers.
router.get('/', (req, res) => {
  const { stream } = req.query;
  if (!stream) return res.json({ code: 0, urls: [], targets: [] });
  const targets = forwardService.getForwardTargets(stream);
  res.json({ code: 0, urls: targets, targets });
});

module.exports = router;
