const express = require('express');
const jwtAuth = require('../middleware/jwt-auth');
const streamService = require('../services/stream-service');

const router = express.Router();
router.use(jwtAuth);

router.get('/', async (req, res) => {
  try {
    const streams = await streamService.listStreams();
    res.json({ streams });
  } catch (err) {
    res.status(500).json({ error: `Failed to fetch streams: ${err.message}` });
  }
});

router.post('/', async (req, res) => {
  try {
    const { name, protocol } = req.body;
    if (!name) return res.status(400).json({ error: 'Stream name is required' });
    const stream = await streamService.createStream(name, protocol);
    res.status(201).json({ stream });
  } catch (err) {
    if (err.message.includes('Invalid stream name')) return res.status(400).json({ error: err.message });
    if (err.message.includes('UNIQUE constraint failed')) return res.status(409).json({ error: 'Stream already exists' });
    res.status(500).json({ error: `Failed to create stream: ${err.message}` });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const stream = await streamService.getStream(req.params.id);
    if (!stream) return res.status(404).json({ error: 'Stream not found' });
    res.json({ stream });
  } catch (err) {
    res.status(500).json({ error: `Failed to fetch stream: ${err.message}` });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { name, protocol } = req.body;
    const stream = await streamService.updateStream(req.params.id, { name, protocol });
    if (!stream) return res.status(404).json({ error: 'Stream not found' });
    res.json({ stream });
  } catch (err) {
    if (err.message.includes('Invalid stream name')) return res.status(400).json({ error: err.message });
    if (err.message.includes('UNIQUE constraint failed')) return res.status(409).json({ error: 'Stream name already in use' });
    res.status(500).json({ error: `Failed to update stream: ${err.message}` });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const result = await streamService.deleteStream(req.params.id);
    if (!result) return res.status(404).json({ error: 'Stream not found' });
    res.json({ message: `Stream "${result.name}" deleted` });
  } catch (err) {
    res.status(500).json({ error: `Failed to delete stream: ${err.message}` });
  }
});

module.exports = router;
