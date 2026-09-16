const express = require('express');
const router = express.Router();
const keyService = require('../services/key-service');
const mask = require('../utils/mask');

router.get('/', (req, res) => {
  const keys = keyService.listKeys();
  res.json(keys.map(k => ({ ...k, key: mask(k.key) })));
});

router.get('/:id', (req, res) => {
  const key = keyService.getKey(req.params.id);
  if (!key) return res.status(404).json({ error: 'Key not found' });
  res.json({ ...key, key: mask(key.key) });
});

router.post('/', (req, res) => {
  try {
    const key = keyService.createKey(req.body);
    res.status(201).json({ ...key, key: mask(key.key) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/:id', (req, res) => {
  const key = keyService.updateKey(req.params.id, req.body);
  if (!key) return res.status(404).json({ error: 'Key not found' });
  res.json({ ...key, key: mask(key.key) });
});

router.delete('/:id', (req, res) => {
  const result = keyService.deleteKey(req.params.id);
  if (!result) return res.status(404).json({ error: 'Key not found' });
  res.json(result);
});

router.post('/:id/rotate', (req, res) => {
  const key = keyService.rotateKey(req.params.id);
  if (!key) return res.status(404).json({ error: 'Key not found' });
  res.json({ ...key, key: mask(key.key) });
});

module.exports = router;
