const express = require('express');
const router = express.Router();
const forwardService = require('../services/forward-service');

router.get('/', (req, res) => {
  res.json(forwardService.listSources());
});

router.get('/:id', (req, res) => {
  const source = forwardService.getSource(req.params.id);
  if (!source) return res.status(404).json({ error: 'Source not found' });
  res.json(source);
});

router.post('/', (req, res) => {
  try {
    const source = forwardService.createSource(req.body);
    res.status(201).json(source);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/:id', (req, res) => {
  const source = forwardService.updateSource(req.params.id, req.body);
  if (!source) return res.status(404).json({ error: 'Source not found' });
  res.json(source);
});

router.delete('/:id', (req, res) => {
  const result = forwardService.deleteSource(req.params.id);
  if (!result) return res.status(404).json({ error: 'Source not found' });
  res.json(result);
});

module.exports = router;
