const express = require('express');
const router = express.Router();
const monitorService = require('../services/monitor-service');

router.get('/dashboard', async (req, res) => {
  try {
    const stats = await monitorService.getDashboardStats();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/streams/:id', async (req, res) => {
  try {
    const data = await monitorService.getStreamMonitor(req.params.id);
    if (!data) return res.status(404).json({ error: 'Stream not found' });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/streams/:id/history', async (req, res) => {
  try {
    const hours = parseInt(req.query.hours, 10) || 24;
    const data = await monitorService.getStreamHistory(req.params.id, hours);
    if (!data) return res.status(404).json({ error: 'Stream not found' });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
