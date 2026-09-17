const express = require('express');
const router = express.Router();
const forwardService = require('../services/forward-service');

function targetsFor(req) {
  const stream = req.body?.stream || req.body?.params?.stream || req.query?.stream;
  return stream ? forwardService.getForwardTargets(stream) : [];
}

function reply(res, targets) {
  // Current SRS Dynamic Forward contract uses data.urls. urls/targets are kept
  // for older SRS Manager deployments that used the former local shape.
  res.json({ code: 0, data: { urls: targets }, urls: targets, targets });
}

// Current SRS calls the backend with POST JSON.
router.post('/', (req, res) => reply(res, targetsFor(req)));
// Backward-compatible GET for older local configurations.
router.get('/', (req, res) => reply(res, targetsFor(req)));

module.exports = router;
