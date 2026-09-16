const express = require('express');
const hooksHandler = require('../services/hooks-handler');

const router = express.Router();

// These endpoints are called by SRS, no JWT required
router.post('/on_publish', (req, res) => {
  hooksHandler.handleOnPublish(req.body);
  res.status(200).json({ ok: true });
});

router.post('/on_unpublish', (req, res) => {
  hooksHandler.handleOnUnpublish(req.body);
  res.status(200).json({ ok: true });
});

router.post('/on_play', (req, res) => {
  hooksHandler.handleOnPlay(req.body);
  res.status(200).json({ ok: true });
});

router.post('/on_stop', (req, res) => {
  hooksHandler.handleOnStop(req.body);
  res.status(200).json({ ok: true });
});

module.exports = router;
