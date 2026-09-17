const express = require('express');
const jwtAuth = require('../middleware/jwt-auth');
const router = express.Router();
const keyService = require('../services/key-service');
const { maskKey: mask } = require('../utils/mask');
router.use(jwtAuth);

router.get('/', (req, res) => {
  const keys = keyService.listKeys();
  res.json(keys.map(k => ({ ...k, key: mask(k.key) })));
});

router.get('/:id', (req, res) => {
  const key = keyService.getKey(req.params.id);
  if (!key) return res.status(404).json({ code: 'NOT_FOUND_KEY', error: 'Key not found', detail: `Key ID: ${req.params.id}` });
  res.json({ ...key, key: mask(key.key) });
});

// Returns the raw key. Only for authenticated admins; never listed in bulk.
router.get('/:id/reveal', (req, res) => {
  const key = keyService.getKey(req.params.id);
  if (!key) return res.status(404).json({ code: 'NOT_FOUND_KEY', error: 'Key not found', detail: `Key ID: ${req.params.id}` });
  res.json({ id: key.id, key: key.key });
});

router.post('/', (req, res) => {
  try {
    const key = keyService.createKey(req.body);
    // Full key returned exactly once at creation time.
    res.status(201).json(key);
  } catch (err) {
    res.status(400).json({ code: 'INTERNAL_SAVE_CREDENTIALS_FAILED', error: err.message });
  }
});

router.put('/:id', (req, res) => {
  try {
    const key = keyService.updateKey(req.params.id, req.body);
    if (!key) return res.status(404).json({ code: 'NOT_FOUND_KEY', error: 'Key not found', detail: `Key ID: ${req.params.id}` });
    res.json({ ...key, key: mask(key.key) });
  } catch (err) {
    res.status(400).json({ code: 'INTERNAL_SAVE_CREDENTIALS_FAILED', error: err.message });
  }
});

router.delete('/:id', (req, res) => {
  const result = keyService.deleteKey(req.params.id);
  if (!result) return res.status(404).json({ code: 'NOT_FOUND_KEY', error: 'Key not found', detail: `Key ID: ${req.params.id}` });
  res.json(result);
});

router.post('/:id/rotate', (req, res) => {
  const key = keyService.rotateKey(req.params.id);
  if (!key) return res.status(404).json({ code: 'NOT_FOUND_KEY', error: 'Key not found', detail: `Key ID: ${req.params.id}` });
  // Rotation generates a new key; show it once so the operator can copy it.
  res.json(key);
});

module.exports = router;
