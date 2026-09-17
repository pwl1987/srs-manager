const express = require('express');
const jwtAuth = require('../middleware/jwt-auth');
const router = express.Router();
const pushTaskService = require('../services/push-task-service');
router.use(jwtAuth);

router.get('/worker-health', (req, res) => {
  res.json(pushTaskService.getWorkerHealth());
});

router.get('/', (req, res) => {
  res.json(pushTaskService.listTasks());
});

router.get('/:id', (req, res) => {
  const task = pushTaskService.getTask(req.params.id);
  if (!task) return res.status(404).json({ code: 'NOT_FOUND_FORWARD_TASK', error: 'Forward task not found' });
  res.json(task);
});

router.post('/', (req, res) => {
  try {
    res.status(201).json(pushTaskService.createTask(req.body));
  } catch (err) {
    res.status(400).json({ code: 'INTERNAL_GENERAL', error: err.message });
  }
});

router.put('/:id', (req, res) => {
  try {
    const updates = { ...req.body };
    if (updates.target_url === '') delete updates.target_url;
    const task = pushTaskService.updateTask(req.params.id, updates);
    if (!task) return res.status(404).json({ code: 'NOT_FOUND_FORWARD_TASK', error: 'Forward task not found' });
    res.json(task);
  } catch (err) {
    res.status(400).json({ code: 'INTERNAL_GENERAL', error: err.message });
  }
});

router.post('/:id/start', (req, res) => {
  try {
    const task = pushTaskService.setDesiredState(req.params.id, 'RUNNING');
    if (!task) return res.status(404).json({ code: 'NOT_FOUND_FORWARD_TASK', error: 'Forward task not found' });
    res.json(task);
  } catch (err) {
    res.status(400).json({ code: 'INTERNAL_GENERAL', error: err.message });
  }
});

router.post('/:id/stop', (req, res) => {
  try {
    const task = pushTaskService.setDesiredState(req.params.id, 'STOPPED');
    if (!task) return res.status(404).json({ code: 'NOT_FOUND_FORWARD_TASK', error: 'Forward task not found' });
    res.json(task);
  } catch (err) {
    res.status(400).json({ code: 'INTERNAL_GENERAL', error: err.message });
  }
});

router.post('/:id/retry', (req, res) => {
  try {
    const task = pushTaskService.retryTask(req.params.id);
    if (!task) return res.status(404).json({ code: 'NOT_FOUND_FORWARD_TASK', error: 'Forward task not found' });
    res.json(task);
  } catch (err) {
    res.status(400).json({ code: 'INTERNAL_GENERAL', error: err.message });
  }
});

router.delete('/:id', (req, res) => {
  try {
    const result = pushTaskService.deleteTask(req.params.id);
    if (!result) return res.status(404).json({ code: 'NOT_FOUND_FORWARD_TASK', error: 'Forward task not found' });
    res.json(result);
  } catch (err) {
    res.status(409).json({ code: 'CONFLICT_GENERAL', error: err.message });
  }
});

module.exports = router;
