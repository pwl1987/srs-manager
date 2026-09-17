const express = require('express');
const jwtAuth = require('../middleware/jwt-auth');
const streamService = require('../services/stream-service');
const streamWorkspaceService = require('../services/stream-workspace-service');
const previewAccessService = require('../services/preview-access-service');

const router = express.Router();
router.use(jwtAuth);

router.get('/', async (req, res) => {
  try {
    const streams = await streamService.listStreams();
    res.json(streams);
  } catch (err) {
    res.status(500).json({ code: 'INTERNAL_FETCH_STREAMS_FAILED', error: `Failed to fetch streams: ${err.message}` });
  }
});

router.post('/', async (req, res) => {
  try {
    const { name, protocol, transcode_template_id } = req.body;
    if (!name) return res.status(400).json({ code: 'VALIDATION_STREAM_NAME_REQUIRED', error: 'Stream name is required' });
    const stream = await streamService.createStream(name, protocol, transcode_template_id);
    res.status(201).json({ stream });
  } catch (err) {
    if (err.message.includes('Invalid stream name')) return res.status(400).json({ code: 'VALIDATION_STREAM_NAME_INVALID', error: err.message });
    if (err.message.includes('Invalid transcode template')) return res.status(400).json({ code: 'NOT_FOUND_TEMPLATE', error: 'Transcode template not found' });
    if (err.message.includes('UNIQUE constraint failed')) return res.status(409).json({ code: 'CONFLICT_STREAM_EXISTS', error: 'Stream already exists' });
    res.status(500).json({ code: 'INTERNAL_CREATE_STREAM_FAILED', error: `Failed to create stream: ${err.message}` });
  }
});

// Must be declared before /:id, otherwise "external-live" is captured as an id.
router.get('/external-live', async (req, res) => {
  try {
    const external = await streamService.listExternalStreams();
    res.json(external);
  } catch (err) {
    res.status(500).json({ code: 'INTERNAL_FETCH_STREAMS_FAILED', error: `Failed to fetch external streams: ${err.message}` });
  }
});

router.post('/:id/preview-access', async (req, res) => {
  try {
    const stream = await streamService.getStream(req.params.id);
    if (!stream) return res.status(404).json({ code: 'NOT_FOUND_STREAM', error: 'Stream not found', detail: `Stream ID: ${req.params.id}` });
    res.json(previewAccessService.issuePreviewToken(stream));
  } catch (err) {
    res.status(500).json({ code: 'INTERNAL_GENERAL', error: `Failed to issue preview access: ${err.message}` });
  }
});

router.get('/:id/workspace', async (req, res) => {
  try {
    const workspace = await streamWorkspaceService.getWorkspace(req.params.id);
    if (!workspace) return res.status(404).json({ code: 'NOT_FOUND_STREAM', error: 'Stream not found', detail: `Stream ID: ${req.params.id}` });
    res.json(workspace);
  } catch (err) {
    res.status(500).json({ code: 'INTERNAL_FETCH_STREAM_FAILED', error: `Failed to build stream workspace: ${err.message}`, detail: `Stream ID: ${req.params.id}` });
  }
});

router.post('/:id/disconnect-publisher', async (req, res) => {
  try {
    const result = await streamService.disconnectPublisher(req.params.id);
    if (!result) return res.status(404).json({ code: 'NOT_FOUND_STREAM', error: 'Stream not found', detail: `Stream ID: ${req.params.id}` });
    res.json(result);
  } catch (err) {
    res.status(500).json({ code: 'INTERNAL_GENERAL', error: `Failed to disconnect publisher: ${err.message}`, detail: `Stream ID: ${req.params.id}` });
  }
});

router.post('/:id/disconnect-viewers', async (req, res) => {
  try {
    const result = await streamService.disconnectViewers(req.params.id);
    if (!result) return res.status(404).json({ code: 'NOT_FOUND_STREAM', error: 'Stream not found', detail: `Stream ID: ${req.params.id}` });
    res.json(result);
  } catch (err) {
    res.status(500).json({ code: 'INTERNAL_GENERAL', error: `Failed to disconnect viewers: ${err.message}`, detail: `Stream ID: ${req.params.id}` });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const stream = await streamService.getStream(req.params.id);
    if (!stream) return res.status(404).json({ code: 'NOT_FOUND_STREAM', error: 'Stream not found', detail: `Stream ID: ${req.params.id}` });
    res.json({ stream });
  } catch (err) {
    res.status(500).json({ code: 'INTERNAL_FETCH_STREAM_FAILED', error: `Failed to fetch stream: ${err.message}`, detail: `Stream ID: ${req.params.id}` });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { name, protocol, transcode_template_id } = req.body;
    const stream = await streamService.updateStream(req.params.id, { name, protocol, transcode_template_id });
    if (!stream) return res.status(404).json({ code: 'NOT_FOUND_STREAM', error: 'Stream not found', detail: `Stream ID: ${req.params.id}` });
    res.json({ stream });
  } catch (err) {
    if (err.message.includes('Invalid stream name')) return res.status(400).json({ code: 'VALIDATION_STREAM_NAME_INVALID', error: err.message });
    if (err.message.includes('Invalid transcode template')) return res.status(400).json({ code: 'NOT_FOUND_TEMPLATE', error: 'Transcode template not found' });
    if (err.message.includes('UNIQUE constraint failed')) return res.status(409).json({ code: 'CONFLICT_STREAM_NAME_IN_USE', error: 'Stream name already in use' });
    res.status(500).json({ code: 'INTERNAL_UPDATE_STREAM_FAILED', error: `Failed to update stream: ${err.message}`, detail: `Stream ID: ${req.params.id}` });
  }
});

// Legacy broad action kept for API compatibility. The new UI intentionally
// avoids it because it kicks both publisher and viewers.
router.post('/:id/stop', async (req, res) => {
  try {
    const result = await streamService.stopStream(req.params.id);
    if (!result) return res.status(404).json({ code: 'NOT_FOUND_STREAM', error: 'Stream not found', detail: `Stream ID: ${req.params.id}` });
    res.json(result);
  } catch (err) {
    res.status(500).json({ code: 'INTERNAL_GENERAL', error: `Failed to stop stream: ${err.message}`, detail: `Stream ID: ${req.params.id}` });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const result = await streamService.deleteStream(req.params.id);
    if (!result) return res.status(404).json({ code: 'NOT_FOUND_STREAM', error: 'Stream not found', detail: `Stream ID: ${req.params.id}` });
    res.json({ message: `Stream "${result.name}" deleted` });
  } catch (err) {
    res.status(500).json({ code: 'INTERNAL_DELETE_STREAM_FAILED', error: `Failed to delete stream: ${err.message}`, detail: `Stream ID: ${req.params.id}` });
  }
});

module.exports = router;
