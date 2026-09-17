const express = require('express');
const jwtAuth = require('../middleware/jwt-auth');
const router = express.Router();
const forwardService = require('../services/forward-service');
router.use(jwtAuth);

router.get('/', (req, res) => {
  res.json(forwardService.listSources());
});

router.get('/:id', (req, res) => {
  const source = forwardService.getSource(req.params.id);
  if (!source) return res.status(404).json({ code: 'NOT_FOUND_FORWARD_SOURCE', error: 'External source not found', detail: `Source ID: ${req.params.id}` });
  res.json(source);
});

router.post('/', (req, res) => {
  try {
    const source = forwardService.createSource(req.body);
    res.status(201).json(source);
  } catch (err) {
    res.status(400).json({ code: 'INTERNAL_GENERAL', error: err.message });
  }
});

router.put('/:id', (req, res) => {
  const source = forwardService.updateSource(req.params.id, req.body);
  if (!source) return res.status(404).json({ code: 'NOT_FOUND_FORWARD_SOURCE', error: 'External source not found', detail: `Source ID: ${req.params.id}` });
  res.json(source);
});

router.delete('/:id', (req, res) => {
  const result = forwardService.deleteSource(req.params.id);
  if (!result) return res.status(404).json({ code: 'NOT_FOUND_FORWARD_SOURCE', error: 'External source not found', detail: `Source ID: ${req.params.id}` });
  res.json(result);
});

module.exports = router;
