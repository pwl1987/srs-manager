const express = require('express');
const jwtAuth = require('../middleware/jwt-auth');
const pullTaskService = require('../services/pull-task-service');

const router = express.Router();
router.use(jwtAuth);

function respondError(res, error) {
  if (error.message === 'Stream not found') {
    return res.status(404).json({ code: 'NOT_FOUND_STREAM', error: error.message });
  }
  if (error.message === 'Source not found or inactive') {
    return res.status(404).json({ code: 'NOT_FOUND_GENERAL', error: error.message });
  }
  if (error.message.includes('already exists')) {
    return res.status(409).json({ code: 'CONFLICT_GENERAL', error: error.message });
  }
  if (error.message.includes('must be stopped')) {
    return res.status(409).json({ code: 'CONFLICT_GENERAL', error: error.message });
  }
  if (error.message.startsWith('Invalid')) {
    return res.status(400).json({ code: 'VALIDATION_TEMPLATE_INVALID', error: error.message });
  }
  return res.status(500).json({ code: 'INTERNAL_GENERAL', error: error.message });
}

router.get('/', (req, res) => {
  try {
    res.json(pullTaskService.listTasks());
  } catch (error) {
    respondError(res, error);
  }
});

router.post('/', (req, res) => {
  try {
    const task = pullTaskService.createTask({
      stream_id: req.body?.stream_id,
      external_source_id: req.body?.external_source_id
    });
    res.status(201).json(task);
  } catch (error) {
    respondError(res, error);
  }
});

router.post('/:id/start', (req, res) => {
  try {
    const task = pullTaskService.setDesiredState(req.params.id, 'RUNNING');
    if (!task) return res.status(404).json({ code: 'NOT_FOUND_GENERAL', error: 'Pull task not found' });
    if (task.runtime_state === 'FAILED') {
      return res.json(pullTaskService.updateRuntime(task.id, {
        runtime_state: 'RETRYING',
        attempt: 0,
        last_error: null,
        next_retry_at: new Date().toISOString(),
        worker_instance_id: null
      }));
    }
    res.json(task);
  } catch (error) {
    respondError(res, error);
  }
});

router.post('/:id/stop', (req, res) => {
  try {
    const task = pullTaskService.setDesiredState(req.params.id, 'STOPPED');
    if (!task) return res.status(404).json({ code: 'NOT_FOUND_GENERAL', error: 'Pull task not found' });
    res.json(task);
  } catch (error) {
    respondError(res, error);
  }
});

router.post('/:id/retry', (req, res) => {
  try {
    const task = pullTaskService.setDesiredState(req.params.id, 'RUNNING');
    if (!task) return res.status(404).json({ code: 'NOT_FOUND_GENERAL', error: 'Pull task not found' });
    res.json(pullTaskService.updateRuntime(task.id, {
      runtime_state: 'RETRYING',
      attempt: 0,
      last_error: null,
      next_retry_at: new Date().toISOString(),
      worker_instance_id: null
    }));
  } catch (error) {
    respondError(res, error);
  }
});

router.delete('/:id', (req, res) => {
  try {
    const result = pullTaskService.deleteTask(req.params.id);
    if (!result) return res.status(404).json({ code: 'NOT_FOUND_GENERAL', error: 'Pull task not found' });
    res.json(result);
  } catch (error) {
    respondError(res, error);
  }
});

module.exports = router;
