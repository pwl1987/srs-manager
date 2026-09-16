const express = require('express');
const router = express.Router();
const forwardService = require('../services/forward-service');

// SRS Forward backend API - no JWT auth required (called by SRS)
router.get('/', (req, res) => {
  const { stream } = req.query;
  if (!stream) return res.json({ targets: [] });
  const targets = forwardService.getForwardTargets(stream);
  res.json({ targets });
});

module.exports = router;
