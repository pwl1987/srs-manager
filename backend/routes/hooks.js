const express = require('express');
const hooksHandler = require('../services/hooks-handler');

const router = express.Router();

// These endpoints are called by SRS, no JWT required.
// SRS http_hooks protocol: HTTP 200 with JSON body {"code": 0} means "allow".
// Any other code (or HTTP error) makes SRS reject/deny the event.
router.post('/on_publish', (req, res) => {
  const result = hooksHandler.handleOnPublish(req.body);
  if (result?.allowed === false) return res.status(200).json({ code: 403, msg: result.reason || 'Publish denied' });
  res.status(200).json({ code: 0 });
});

router.post('/on_unpublish', (req, res) => {
  hooksHandler.handleOnUnpublish(req.body);
  res.status(200).json({ code: 0 });
});

router.post('/on_play', (req, res) => {
  const result = hooksHandler.handleOnPlay(req.body);
  if (result?.allowed === false) {
    return res.status(200).json({ code: 403, msg: result.reason || 'Playback denied' });
  }
  res.status(200).json({ code: 0 });
});

router.post('/on_stop', (req, res) => {
  hooksHandler.handleOnStop(req.body);
  res.status(200).json({ code: 0 });
});

module.exports = router;
