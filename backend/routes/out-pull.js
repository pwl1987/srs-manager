const express = require('express');
const jwtAuth = require('../middleware/jwt-auth');
const outPullService = require('../services/out-pull-service');

const router = express.Router();
router.use(jwtAuth);

router.get('/streams/:streamId', (req, res) => {
  const overview = outPullService.getOverview(req.params.streamId);
  if (!overview) return res.status(404).json({ code: 'NOT_FOUND_STREAM', error: 'Stream not found' });
  res.json(overview);
});

router.put('/streams/:streamId/policy', (req, res) => {
  try {
    const policy = outPullService.updatePolicy(req.params.streamId, req.body || {});
    if (!policy) return res.status(404).json({ code: 'NOT_FOUND_STREAM', error: 'Stream not found' });
    res.json(policy);
  } catch (err) {
    res.status(400).json({ code: 'INTERNAL_GENERAL', error: err.message });
  }
});

router.post('/streams/:streamId/grants', (req, res) => {
  try {
    const grant = outPullService.createGrant(req.params.streamId, {
      ...req.body,
      created_by: req.user?.username || null
    });
    res.status(201).json(grant);
  } catch (err) {
    const status = String(err.message).includes('Stream not found') ? 404 : 400;
    res.status(status).json({ code: status === 404 ? 'NOT_FOUND_STREAM' : 'INTERNAL_GENERAL', error: err.message });
  }
});

router.post('/streams/:streamId/grants/:grantId/revoke', (req, res) => {
  const grant = outPullService.revokeGrant(req.params.streamId, req.params.grantId);
  if (!grant) return res.status(404).json({ code: 'NOT_FOUND_GENERAL', error: 'Access grant not found' });
  res.json(grant);
});

module.exports = router;
