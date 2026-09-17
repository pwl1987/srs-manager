const express = require('express');
const jwtAuth = require('../middleware/jwt-auth');
const router = express.Router();
const forwardService = require('../services/forward-service');
router.use(jwtAuth);

router.get('/', (req, res) => {
  res.json(forwardService.listTasks());
});

router.get('/:id', (req, res) => {
  const task = forwardService.getTask(req.params.id);
  if (!task) return res.status(404).json({ code: 'NOT_FOUND_FORWARD_TASK', error: 'Forward task not found', detail: `Task ID: ${req.params.id}` });
  res.json(task);
});

router.post('/', (req, res) => {
  try {
    const task = forwardService.createTask(req.body);
    res.status(201).json(task);
  } catch (err) {
    res.status(400).json({ code: 'INTERNAL_GENERAL', error: err.message });
  }
});

router.put('/:id', (req, res) => {
  const task = forwardService.updateTask(req.params.id, req.body);
  if (!task) return res.status(404).json({ code: 'NOT_FOUND_FORWARD_TASK', error: 'Forward task not found', detail: `Task ID: ${req.params.id}` });
  res.json(task);
});

router.delete('/:id', (req, res) => {
  const result = forwardService.deleteTask(req.params.id);
  if (!result) return res.status(404).json({ code: 'NOT_FOUND_FORWARD_TASK', error: 'Forward task not found', detail: `Task ID: ${req.params.id}` });
  res.json(result);
});

module.exports = router;
