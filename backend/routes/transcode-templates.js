const express = require('express');
const jwtAuth = require('../middleware/jwt-auth');
const router = express.Router();
const transcodeService = require('../services/transcode-service');
router.use(jwtAuth);

router.get('/', (req, res) => {
  res.json(transcodeService.listTemplates());
});

router.get('/:id', (req, res) => {
  const template = transcodeService.getTemplate(req.params.id);
  if (!template) return res.status(404).json({ code: 'NOT_FOUND_TEMPLATE', error: 'Transcode template not found', detail: `Template ID: ${req.params.id}` });
  res.json(template);
});

router.get('/:id/srs-config', (req, res) => {
  const template = transcodeService.getTemplate(req.params.id);
  if (!template) return res.status(404).json({ code: 'NOT_FOUND_TEMPLATE', error: 'Transcode template not found', detail: `Template ID: ${req.params.id}` });
  res.json({ config: transcodeService.generateSrsConfig(template) });
});

router.post('/', (req, res) => {
  try {
    const template = transcodeService.createTemplate(req.body);
    res.status(201).json(template);
  } catch (err) {
    res.status(400).json({ code: 'VALIDATION_TEMPLATE_INVALID', error: err.message });
  }
});

router.put('/:id', (req, res) => {
  const template = transcodeService.updateTemplate(req.params.id, req.body);
  if (!template) return res.status(404).json({ code: 'NOT_FOUND_TEMPLATE', error: 'Transcode template not found', detail: `Template ID: ${req.params.id}` });
  res.json(template);
});

router.delete('/:id', (req, res) => {
  const result = transcodeService.deleteTemplate(req.params.id);
  if (!result) return res.status(404).json({ code: 'NOT_FOUND_TEMPLATE', error: 'Transcode template not found', detail: `Template ID: ${req.params.id}` });
  res.json(result);
});

module.exports = router;
