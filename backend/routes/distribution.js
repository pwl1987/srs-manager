const express = require('express');
const jwtAuth = require('../middleware/jwt-auth');
const router = express.Router();
const distributionService = require('../services/distribution-service');
router.use(jwtAuth);

router.get('/', (req, res) => {
  const requests = distributionService.listRequests(req.query);
  res.json(requests);
});

router.get('/by-applicant/:applicant', (req, res) => {
  const requests = distributionService.getRequestsByApplicant(req.params.applicant);
  res.json(requests);
});

router.get('/:id', (req, res) => {
  const request = distributionService.getRequest(req.params.id);
  if (!request) return res.status(404).json({ code: 'NOT_FOUND_DISTRIBUTION', error: 'Distribution request not found', detail: `Request ID: ${req.params.id}` });
  res.json(request);
});

router.get('/:id/logs', (req, res) => {
  const request = distributionService.getRequest(req.params.id);
  if (!request) return res.status(404).json({ code: 'NOT_FOUND_DISTRIBUTION', error: 'Distribution request not found', detail: `Request ID: ${req.params.id}` });
  res.json(distributionService.getRequestLogs(req.params.id));
});

router.post('/', async (req, res) => {
  try {
    const request = await distributionService.createRequest(req.body);
    res.status(201).json(request);
  } catch (err) {
    if (err.message.includes('required') || err.message.includes('not found')) {
      return res.status(400).json({ code: 'VALIDATION_CHANNEL_PARAMS_MISSING', error: err.message });
    }
    res.status(500).json({ code: 'INTERNAL_GENERAL', error: err.message });
  }
});

router.put('/:id', (req, res) => {
  try {
    const request = distributionService.updateRequest(req.params.id, req.body);
    if (!request) return res.status(404).json({ code: 'NOT_FOUND_DISTRIBUTION', error: 'Distribution request not found', detail: `Request ID: ${req.params.id}` });
    res.json(request);
  } catch (err) {
    res.status(500).json({ code: 'INTERNAL_GENERAL', error: err.message, detail: `Request ID: ${req.params.id}` });
  }
});

router.delete('/:id', (req, res) => {
  try {
    const result = distributionService.deleteRequest(req.params.id);
    if (!result) return res.status(404).json({ code: 'NOT_FOUND_DISTRIBUTION', error: 'Distribution request not found', detail: `Request ID: ${req.params.id}` });
    res.json(result);
  } catch (err) {
    res.status(500).json({ code: 'INTERNAL_GENERAL', error: err.message, detail: `Request ID: ${req.params.id}` });
  }
});

router.put('/:id/extend', async (req, res) => {
  try {
    const request = await distributionService.extendRequest(req.params.id, req.body.new_expiry);
    res.json(request);
  } catch (err) {
    if (err.message.includes('not found')) return res.status(404).json({ code: 'NOT_FOUND_DISTRIBUTION', error: err.message, detail: `Request ID: ${req.params.id}` });
    res.status(400).json({ code: 'INTERNAL_GENERAL', error: err.message, detail: `Request ID: ${req.params.id}` });
  }
});

router.put('/:id/revoke', async (req, res) => {
  try {
    const request = await distributionService.revokeRequest(req.params.id);
    res.json(request);
  } catch (err) {
    if (err.message.includes('not found')) return res.status(404).json({ code: 'NOT_FOUND_DISTRIBUTION', error: err.message, detail: `Request ID: ${req.params.id}` });
    res.status(400).json({ code: 'INTERNAL_GENERAL', error: err.message, detail: `Request ID: ${req.params.id}` });
  }
});

module.exports = router;
