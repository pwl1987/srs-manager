const express = require('express');
const jwtAuth = require('../middleware/jwt-auth');
const router = express.Router();
const forwardService = require('../services/forward-service');
const { maskSourceUrl } = require('../services/pull-task-service');
router.use(jwtAuth);

function publicSource(source) {
  if (!source) return null;
  const { source_url, ...rest } = source;
  return { ...rest, source_url_masked: maskSourceUrl(source_url) };
}

router.get('/', (req, res) => {
  res.json(forwardService.listSources().map(publicSource));
});

router.get('/:id', (req, res) => {
  const source = forwardService.getSource(req.params.id);
  if (!source) return res.status(404).json({ code: 'NOT_FOUND_FORWARD_SOURCE', error: 'External source not found', detail: `Source ID: ${req.params.id}` });
  res.json(publicSource(source));
});

router.post('/', (req, res) => {
  try {
    const source = forwardService.createSource(req.body);
    res.status(201).json(publicSource(source));
  } catch (err) {
    res.status(400).json({ code: 'INTERNAL_GENERAL', error: err.message });
  }
});

router.put('/:id', (req, res) => {
  try {
    const updates = { ...req.body };
    // An empty URL on edit means "keep the existing secret". The browser no
    // longer receives the raw credential-bearing source URL just to render an
    // edit form.
    if (updates.source_url === '') delete updates.source_url;
    const source = forwardService.updateSource(req.params.id, updates);
    if (!source) return res.status(404).json({ code: 'NOT_FOUND_FORWARD_SOURCE', error: 'External source not found', detail: `Source ID: ${req.params.id}` });
    res.json(publicSource(source));
  } catch (err) {
    res.status(400).json({ code: 'INTERNAL_GENERAL', error: err.message });
  }
});

router.delete('/:id', (req, res) => {
  try {
    const result = forwardService.deleteSource(req.params.id);
    if (!result) return res.status(404).json({ code: 'NOT_FOUND_FORWARD_SOURCE', error: 'External source not found', detail: `Source ID: ${req.params.id}` });
    res.json(result);
  } catch (err) {
    if (String(err.message).includes('FOREIGN KEY constraint failed')) {
      return res.status(409).json({ code: 'CONFLICT_GENERAL', error: 'External source is still referenced by a runtime task' });
    }
    res.status(500).json({ code: 'INTERNAL_GENERAL', error: err.message });
  }
});

module.exports = router;
