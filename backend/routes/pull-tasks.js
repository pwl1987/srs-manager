const express = require('express');
const jwtAuth = require('../middleware/jwt-auth');
const pullTaskService = require('../services/pull-task-service');
const operationService = require('../services/operation-service');

const router = express.Router();
router.use(jwtAuth);

function respondError(res, error) {
  if (error.message === 'Stream not found' || error.message === 'Pull task not found') {
    return res.status(404).json({ code: 'NOT_FOUND_STREAM', error: error.message });
  }
  if (error.message === 'Source not found or inactive' || error.message === 'Pull task source not found') {
    return res.status(404).json({ code: 'NOT_FOUND_GENERAL', error: error.message });
  }
  if (
    error.message.includes('already exists')
    || error.message.includes('must be stopped')
    || error.message.includes('cannot be disabled')
    || error.message.includes('cannot be removed')
    || error.message.includes('must keep at least one')
    || error.message.includes('has no enabled source')
    || error.message.includes('already active')
    || error.message.includes('already in progress')
    || error.message.includes('must be RUNNING')
    || error.message.includes('not enabled or active')
  ) {
    return res.status(409).json({ code: 'CONFLICT_GENERAL', error: error.message });
  }
  if (error.message.startsWith('Invalid') || error.message.includes('priority')) {
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

router.get('/:id/sources', (req, res) => {
  try {
    const task = pullTaskService.getTask(req.params.id);
    if (!task) return res.status(404).json({ code: 'NOT_FOUND_GENERAL', error: 'Pull task not found' });
    res.json(task.sources || []);
  } catch (error) {
    respondError(res, error);
  }
});

router.post('/:id/sources', (req, res) => {
  try {
    const task = pullTaskService.addTaskSource(
      req.params.id,
      req.body?.external_source_id,
      req.body?.priority
    );
    res.status(201).json(task);
  } catch (error) {
    respondError(res, error);
  }
});

router.put('/:id/sources/:sourceId', (req, res) => {
  try {
    const task = pullTaskService.updateTaskSource(req.params.id, req.params.sourceId, {
      priority: req.body?.priority,
      enabled: req.body?.enabled
    });
    res.json(task);
  } catch (error) {
    respondError(res, error);
  }
});

router.delete('/:id/sources/:sourceId', (req, res) => {
  try {
    const task = pullTaskService.deleteTaskSource(req.params.id, req.params.sourceId);
    res.json(task);
  } catch (error) {
    respondError(res, error);
  }
});

router.get('/:id/operations', (req, res) => {
  try {
    const task = pullTaskService.getTask(req.params.id);
    if (!task) return res.status(404).json({ code: 'NOT_FOUND_GENERAL', error: 'Pull task not found' });
    res.json(operationService.listPullOperations(req.params.id, req.query?.limit));
  } catch (error) {
    respondError(res, error);
  }
});

router.post('/:id/switch-source', (req, res) => {
  try {
    const requestedBy = req.user?.username || req.user?.sub || req.user?.userId || null;
    const operation = operationService.requestPullSourceSwitch(
      req.params.id,
      req.body?.target_source_id,
      requestedBy
    );
    res.status(202).json(operation);
  } catch (error) {
    respondError(res, error);
  }
});

router.post('/:id/start', (req, res) => {
  try {
    let task = pullTaskService.ensureUsableActiveSource(req.params.id);
    if (!task) return res.status(404).json({ code: 'NOT_FOUND_GENERAL', error: 'Pull task not found' });
    if (!task.sources?.some(source => source.enabled && source.source_status === 'active')) {
      return res.status(409).json({ code: 'CONFLICT_GENERAL', error: 'Pull task has no enabled source' });
    }
    task = pullTaskService.setDesiredState(req.params.id, 'RUNNING');
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
    operationService.cancelActivePullSwitch(req.params.id, 'Pull task stopped by user');
    const task = pullTaskService.setDesiredState(req.params.id, 'STOPPED');
    if (!task) return res.status(404).json({ code: 'NOT_FOUND_GENERAL', error: 'Pull task not found' });
    res.json(task);
  } catch (error) {
    respondError(res, error);
  }
});

router.post('/:id/retry', (req, res) => {
  try {
    let task = pullTaskService.ensureUsableActiveSource(req.params.id);
    if (!task) return res.status(404).json({ code: 'NOT_FOUND_GENERAL', error: 'Pull task not found' });
    if (!task.sources?.some(source => source.enabled && source.source_status === 'active')) {
      return res.status(409).json({ code: 'CONFLICT_GENERAL', error: 'Pull task has no enabled source' });
    }
    task = pullTaskService.setDesiredState(req.params.id, 'RUNNING');
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
