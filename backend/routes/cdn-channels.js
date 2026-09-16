const express = require('express');
const jwtAuth = require('../middleware/jwt-auth');
const cdnService = require('../services/cdn-service');

const router = express.Router();
router.use(jwtAuth);

router.get('/', async (req, res) => {
  try {
    const channels = await cdnService.listChannels();
    res.json({ channels });
  } catch (err) {
    res.status(500).json({ error: `Failed to fetch channels: ${err.message}` });
  }
});

router.post('/', async (req, res) => {
  try {
    const channel = await cdnService.createChannel(req.body);
    res.status(201).json({ channel });
  } catch (err) {
    if (err.message.includes('required')) return res.status(400).json({ error: err.message });
    res.status(500).json({ error: `Failed to create channel: ${err.message}` });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const channel = await cdnService.getChannel(req.params.id);
    if (!channel) return res.status(404).json({ error: 'Channel not found' });
    res.json({ channel });
  } catch (err) {
    res.status(500).json({ error: `Failed to fetch channel: ${err.message}` });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const channel = await cdnService.updateChannel(req.params.id, req.body);
    if (!channel) return res.status(404).json({ error: 'Channel not found' });
    res.json({ channel });
  } catch (err) {
    res.status(500).json({ error: `Failed to update channel: ${err.message}` });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const result = await cdnService.deleteChannel(req.params.id);
    if (!result) return res.status(404).json({ error: 'Channel not found' });
    res.json({ message: `Channel "${result.name}" deleted` });
  } catch (err) {
    res.status(500).json({ error: `Failed to delete channel: ${err.message}` });
  }
});

router.get('/batch-state', async (req, res) => {
  try {
    const states = await cdnService.getBatchState();
    res.json({ states });
  } catch (err) {
    res.status(500).json({ error: `Failed to fetch channel states: ${err.message}` });
  }
});

module.exports = router;
