const express = require('express');
const jwtAuth = require('../middleware/jwt-auth');
const router = express.Router();
const monitorService = require('../services/monitor-service');
router.use(jwtAuth);

// 路由参数 :id 为数据库自增主键，入口处限定为纯数字，阻断其流入下游 URL 拼接
function numericId(req, res) {
  const id = String(req.params.id);
  if (!/^\d+$/.test(id)) {
    res.status(400).json({ code: 'VALIDATION_STREAM_NAME_INVALID', error: 'Invalid stream ID', detail: `Stream ID must be numeric: ${id}` });
    return null;
  }
  return id;
}

router.get('/dashboard', async (req, res) => {
  try {
    const stats = await monitorService.getDashboardStats();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ code: 'INTERNAL_GENERAL', error: err.message });
  }
});

// Recent SRS hook events for the dashboard activity feed.
router.get('/activity', (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
    const events = require('../database')
      .prepare('SELECT event_type, stream_name, processed_at FROM hook_events ORDER BY processed_at DESC LIMIT ?')
      .all(limit);
    res.json(events);
  } catch (err) {
    res.status(500).json({ code: 'INTERNAL_GENERAL', error: err.message });
  }
});

router.get('/streams/:id', async (req, res) => {
  const id = numericId(req, res);
  if (id === null) return;
  try {
    const data = await monitorService.getStreamMonitor(id);
    if (!data) return res.status(404).json({ code: 'NOT_FOUND_STREAM', error: 'Stream not found', detail: `Stream ID: ${id}` });
    res.json(data);
  } catch (err) {
    res.status(500).json({ code: 'INTERNAL_GENERAL', error: err.message, detail: `Stream ID: ${id}` });
  }
});

router.get('/streams/:id/history', async (req, res) => {
  const id = numericId(req, res);
  if (id === null) return;
  try {
    const hours = parseInt(req.query.hours, 10) || 24;
    const data = await monitorService.getStreamHistory(id, hours);
    if (!data) return res.status(404).json({ code: 'NOT_FOUND_STREAM', error: 'Stream not found', detail: `Stream ID: ${id}` });
    res.json(data);
  } catch (err) {
    res.status(500).json({ code: 'INTERNAL_GENERAL', error: err.message, detail: `Stream ID: ${id}` });
  }
});

module.exports = router;
