const express = require('express');
const router = express.Router();
const forwardService = require('../services/forward-service');

router.get('/', (req, res) => {
  res.json(forwardService.listTasks());
});

router.get('/:id', (req, res) => {
  const task = forwardService.getTask(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  res.json(task);
});

router.post('/', (req, res) => {
  try {
    const task = forwardService.createTask(req.body);
    res.status(201).json(task);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/:id', (req, res) => {
  const task = forwardService.updateTask(req.params.id, req.body);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  res.json(task);
});

router.delete('/:id', (req, res) => {
  const result = forwardService.deleteTask(req.params.id);
  if (!result) return res.status(404).json({ error: 'Task not found' });
  res.json(result);
});

module.exports = router;
