const db = require('../database');
const pullTaskService = require('./pull-task-service');

const PULL_SWITCH_TYPE = 'PULL_SOURCE_SWITCH';
const ACTIVE_PULL_SWITCH_STATES = new Set(['QUEUED', 'STOPPING', 'STARTING', 'VERIFYING']);
const TERMINAL_STATES = new Set(['SUCCEEDED', 'FAILED', 'CANCELLED']);
const TRANSITIONS = {
  QUEUED: new Set(['STOPPING', 'FAILED', 'CANCELLED']),
  STOPPING: new Set(['STARTING', 'FAILED', 'CANCELLED']),
  STARTING: new Set(['VERIFYING', 'FAILED', 'CANCELLED']),
  VERIFYING: new Set(['SUCCEEDED', 'FAILED', 'CANCELLED'])
};

function parseJson(value) {
  if (!value) return null;
  try { return JSON.parse(value); } catch { return null; }
}

function hydrate(row) {
  if (!row) return null;
  return {
    id: row.id,
    type: row.type,
    subject_type: row.subject_type,
    subject_id: row.subject_id,
    state: row.state,
    requested_by: row.requested_by,
    payload: parseJson(row.payload_json),
    result: parseJson(row.result_json),
    error: row.error,
    started_at: row.started_at,
    completed_at: row.completed_at,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function getOperation(id) {
  return hydrate(db.prepare('SELECT * FROM operations WHERE id = ?').get(id));
}

function getActivePullSwitch(taskId) {
  const row = db.prepare(`
    SELECT * FROM operations
    WHERE type = ? AND subject_type = 'pull_task' AND subject_id = ?
      AND state IN ('QUEUED', 'STOPPING', 'STARTING', 'VERIFYING')
    ORDER BY id DESC LIMIT 1
  `).get(PULL_SWITCH_TYPE, Number(taskId));
  return hydrate(row);
}

function listPullOperations(taskId, limit = 10) {
  const size = Math.max(1, Math.min(50, Number(limit) || 10));
  return db.prepare(`
    SELECT * FROM operations
    WHERE subject_type = 'pull_task' AND subject_id = ?
    ORDER BY id DESC LIMIT ?
  `).all(Number(taskId), size).map(hydrate);
}

function requestPullSourceSwitch(taskId, targetSourceId, requestedBy = null, idempotencyKey = null) {
  const id = Number(taskId);
  const targetId = Number(targetSourceId);
  if (!Number.isInteger(id) || id <= 0) throw new Error('Invalid pull task');
  if (!Number.isInteger(targetId) || targetId <= 0) throw new Error('Invalid target source');
  const key = idempotencyKey ? String(idempotencyKey).trim() : null;
  if (key) {
    const existing = db.prepare(`SELECT * FROM operations WHERE type = ? AND subject_type = 'pull_task' AND subject_id = ? AND idempotency_key = ? ORDER BY id DESC LIMIT 1`).get(PULL_SWITCH_TYPE, id, key);
    if (existing) return hydrate(existing);
  }

  const create = db.transaction(() => {
    if (key) {
      const existing = db.prepare(`SELECT * FROM operations WHERE type = ? AND subject_type = 'pull_task' AND subject_id = ? AND idempotency_key = ? ORDER BY id DESC LIMIT 1`).get(PULL_SWITCH_TYPE, id, key);
      if (existing) return Number(existing.id);
    }
    const task = pullTaskService.getTask(id);
    if (!task) throw new Error('Pull task not found');
    if (task.desired_state !== 'RUNNING') throw new Error('Pull task must be RUNNING before source switch');
    if (Number(task.active_source_id) === targetId) throw new Error('Target source is already active');

    const candidate = (task.sources || []).find(source =>
      Number(source.external_source_id) === targetId
        && source.enabled
        && source.source_status === 'active'
    );
    if (!candidate) throw new Error('Target source not enabled or active');
    if (getActivePullSwitch(id)) throw new Error('Pull source switch already in progress');

    const payload = JSON.stringify({
      from_source_id: Number(task.active_source_id),
      target_source_id: targetId
    });
    const result = db.prepare(`
      INSERT INTO operations (type, subject_type, subject_id, state, requested_by, payload_json, idempotency_key)
      VALUES (?, 'pull_task', ?, 'QUEUED', ?, ?, ?)
    `).run(PULL_SWITCH_TYPE, id, requestedBy || null, payload, key);
    return Number(result.lastInsertRowid);
  });

  try {
    return getOperation(create.immediate());
  } catch (error) {
    if (String(error.message).includes('UNIQUE constraint failed')) {
      throw new Error('Pull source switch already in progress');
    }
    throw error;
  }
}

function transitionOperation(id, nextState, { error = null, result = null } = {}) {
  const operation = getOperation(id);
  if (!operation) throw new Error('Operation not found');
  if (operation.type !== PULL_SWITCH_TYPE) throw new Error('Unsupported operation type');
  if (operation.state === nextState) return operation;
  const allowed = TRANSITIONS[operation.state];
  if (!allowed?.has(nextState)) throw new Error(`Invalid operation transition: ${operation.state} -> ${nextState}`);

  const terminal = TERMINAL_STATES.has(nextState);
  const starting = operation.state === 'QUEUED' && nextState === 'STOPPING';
  db.prepare(`
    UPDATE operations
    SET state = ?, error = ?, result_json = ?,
        started_at = CASE WHEN ? THEN COALESCE(started_at, CURRENT_TIMESTAMP) ELSE started_at END,
        completed_at = CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE completed_at END,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    nextState,
    error || null,
    result == null ? null : JSON.stringify(result),
    starting ? 1 : 0,
    terminal ? 1 : 0,
    id
  );
  return getOperation(id);
}

function cancelActivePullSwitch(taskId, reason = 'Pull task stopped by user') {
  const operation = getActivePullSwitch(taskId);
  if (!operation) return null;
  return transitionOperation(operation.id, 'CANCELLED', { error: reason });
}

function failOperation(id, error, result = null) {
  const operation = getOperation(id);
  if (!operation) return null;
  if (TERMINAL_STATES.has(operation.state)) return operation;
  return transitionOperation(id, 'FAILED', { error: String(error || 'Operation failed'), result });
}

module.exports = {
  PULL_SWITCH_TYPE,
  ACTIVE_PULL_SWITCH_STATES,
  getOperation,
  getActivePullSwitch,
  listPullOperations,
  requestPullSourceSwitch,
  transitionOperation,
  cancelActivePullSwitch,
  failOperation
};
