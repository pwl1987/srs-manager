const express = require('express');
const router = express.Router();
const distributionService = require('../services/distribution-service');

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
  if (!request) return res.status(404).json({ error: 'Request not found' });
  res.json(request);
});

router.get('/:id/logs', (req, res) => {
  const logs = distributionService.getRequestLogs(req.params.id);
  res.json(logs);
});

router.post('/', async (req, res) => {
  try {
    const request = await distributionService.createRequest(req.body);
    res.status(201).json(request);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/:id/extend', async (req, res) => {
  try {
    const request = await distributionService.extendRequest(req.params.id, req.body.new_expiry);
    res.json(request);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/:id/revoke', async (req, res) => {
  try {
    const request = await distributionService.revokeRequest(req.params.id);
    res.json(request);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
