const express = require('express');
const jwtAuth = require('../middleware/jwt-auth');
const service = require('../services/transcode-binding-service');

const router = express.Router();
router.use(jwtAuth);

router.get('/worker-health', (req, res) => {
  res.json(service.getWorkerHealth());
});

router.get('/', (req, res) => {
  try {
    const streamId = req.query.stream_id;
    if (!streamId) return res.status(400).json({ code: 'VALIDATION_STREAM_REQUIRED', error: 'stream_id is required' });
    res.json(service.listBindingsByStream(streamId));
  } catch (err) {
    res.status(400).json({ code: 'INTERNAL_GENERAL', error: err.message });
  }
});

router.get('/:id', (req, res) => {
  const binding = service.getBinding(req.params.id);
  if (!binding) return res.status(404).json({ code: 'NOT_FOUND_TRANSCODE_BINDING', error: 'Transcode binding not found' });
  res.json(binding);
});

router.post('/', (req, res) => {
  try {
    res.status(201).json(service.createBinding(req.body));
  } catch (err) {
    const conflict = String(err.message).includes('UNIQUE constraint failed');
    res.status(conflict ? 409 : 400).json({
      code: conflict ? 'CONFLICT_TRANSCODE_BINDING' : 'VALIDATION_TRANSCODE_BINDING',
      error: err.message
    });
  }
});

router.put('/:id', (req, res) => {
  try {
    const binding = service.updateBinding(req.params.id, req.body);
    if (!binding) return res.status(404).json({ code: 'NOT_FOUND_TRANSCODE_BINDING', error: 'Transcode binding not found' });
    res.json(binding);
  } catch (err) {
    const conflict = String(err.message).includes('UNIQUE constraint failed');
    res.status(conflict ? 409 : 400).json({
      code: conflict ? 'CONFLICT_TRANSCODE_BINDING' : 'VALIDATION_TRANSCODE_BINDING',
      error: err.message
    });
  }
});

for (const [action, fn] of [
  ['start', id => service.setDesiredState(id, 'RUNNING')],
  ['stop', id => service.setDesiredState(id, 'STOPPED')],
  ['retry', id => service.retryBinding(id)]
]) {
  router.post(`/:id/${action}`, (req, res) => {
    try {
      const binding = fn(req.params.id);
      if (!binding) {
        return res.status(404).json({
          code: 'NOT_FOUND_TRANSCODE_BINDING',
          error: 'Transcode binding not found'
        });
      }
      res.json(binding);
    } catch (err) {
      res.status(400).json({
        code: 'VALIDATION_TRANSCODE_BINDING',
        error: err.message
      });
    }
  });
}

router.delete('/:id', (req, res) => {
  try {
    const result = service.deleteBinding(req.params.id);
    if (!result) {
      return res.status(404).json({
        code: 'NOT_FOUND_TRANSCODE_BINDING',
        error: 'Transcode binding not found'
      });
    }
    res.json(result);
  } catch (err) {
    res.status(409).json({
      code: 'CONFLICT_TRANSCODE_BINDING',
      error: err.message
    });
  }
});

module.exports = router;
