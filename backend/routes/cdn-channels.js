const express = require('express');
const jwtAuth = require('../middleware/jwt-auth');
const cdnService = require('../services/cdn-service');
const wangsuService = require('../services/wangsu');

const router = express.Router();
router.use(jwtAuth);

router.get('/', async (req, res) => {
  try {
    const channels = await cdnService.listChannels();
    res.json(channels);
  } catch (err) {
    res.status(500).json({ code: 'INTERNAL_FETCH_CHANNELS_FAILED', error: `Failed to fetch channels: ${err.message}` });
  }
});

router.post('/', async (req, res) => {
  try {
    if (!wangsuService.isConfigured()) {
      return res.status(400).json({
        code: 'VALIDATION_WANGSU_AUTH_MISSING',
        error: 'Wangsu CDN credentials not configured',
        detail: 'Configure the AccessKey on the Wangsu Auth page before creating channels'
      });
    }
    const { channel, dnsRecord } = await cdnService.createChannel(req.body);
    res.status(201).json({ channel, dnsRecord: dnsRecord || null });
  } catch (err) {
    if (err.message.includes('required')) return res.status(400).json({ code: 'VALIDATION_CHANNEL_PARAMS_MISSING', error: 'Channel parameters missing', detail: err.message });
    res.status(500).json({ code: 'INTERNAL_CREATE_CHANNEL_FAILED', error: `Failed to create channel: ${err.message}` });
  }
});

// Must be declared before /:id, otherwise "batch-state" is captured as an id.
router.get('/batch-state', async (req, res) => {
  try {
    const states = await cdnService.getBatchState();
    res.json({ states });
  } catch (err) {
    res.status(500).json({ code: 'INTERNAL_FETCH_CHANNEL_STATES_FAILED', error: `Failed to fetch channel states: ${err.message}` });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const channel = await cdnService.getChannel(req.params.id);
    if (!channel) return res.status(404).json({ code: 'NOT_FOUND_CHANNEL', error: 'Channel not found', detail: `Channel ID: ${req.params.id}` });
    res.json({ channel });
  } catch (err) {
    res.status(500).json({ code: 'INTERNAL_FETCH_CHANNEL_FAILED', error: `Failed to fetch channel: ${err.message}`, detail: `Channel ID: ${req.params.id}` });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const channel = await cdnService.updateChannel(req.params.id, req.body);
    if (!channel) return res.status(404).json({ code: 'NOT_FOUND_CHANNEL', error: 'Channel not found', detail: `Channel ID: ${req.params.id}` });
    res.json({ channel });
  } catch (err) {
    res.status(500).json({ code: 'INTERNAL_UPDATE_CHANNEL_FAILED', error: `Failed to update channel: ${err.message}`, detail: `Channel ID: ${req.params.id}` });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const result = await cdnService.deleteChannel(req.params.id);
    if (!result) return res.status(404).json({ code: 'NOT_FOUND_CHANNEL', error: 'Channel not found', detail: `Channel ID: ${req.params.id}` });
    res.json({ message: `Channel "${result.name}" deleted` });
  } catch (err) {
    res.status(500).json({ code: 'INTERNAL_DELETE_CHANNEL_FAILED', error: `Failed to delete channel: ${err.message}`, detail: `Channel ID: ${req.params.id}` });
  }
});

module.exports = router;
