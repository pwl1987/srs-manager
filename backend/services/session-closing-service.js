const outputService = require('./v3-output-service');
const pushTaskService = require('./push-task-service');
const recordTaskService = require('./record-task-service');
const pullTaskService = require('./pull-task-service');
const outPullService = require('./out-pull-service');
const operationCore = require('./v3-operation-core');
const sessionService = require('./session-service');

const CLOSE_TIMEOUT_MS = Number(process.env.SESSION_CLOSE_TIMEOUT_MS || 60000);
const TERMINAL = new Set(['SUCCEEDED', 'FAILED', 'CANCELLED']);
function requestedBy(options) { return options.requested_by || null; }
function closeKey(sessionId, stage, outputRef) { return `session:${sessionId}:close:${stage}:${outputRef}`; }
function ageMs(operation) {
  const started = Date.parse(operation.started_at || operation.created_at || '');
  return Number.isFinite(started) ? Math.max(0, Date.now() - started) : 0;
}

function reconcileOutputOperation(operation) {
  if (!operation) return null;
  if (operation.subject_type === 'forward_task') return outputService.reconcilePushOperation(operation);
  if (operation.subject_type === 'record_task') return outputService.reconcileRecordOperation(operation);
  return operation;
}
function stopPush(session, item, options) {
  const id = outputService.parsePushOutputId(item.output_ref);
  if (!id) return null;
  const task = pushTaskService.getTask(id);
  if (!task || Number(task.stream_id) !== Number(session.stream_id)) return { output_ref: item.output_ref, status: 'FAILED', error: 'PUSH Output no longer belongs to this Room' };
  if (task.execution_mode !== 'managed_worker') return { output_ref: item.output_ref, status: 'FAILED', error: 'Legacy Dynamic Forward cannot be closed by Session orchestration' };
  const result = outputService.startOrStopPush(id, 'STOPPED', { idempotency_key: closeKey(session.id, 'network', item.output_ref), requested_by: requestedBy(options) });
  if (result.conflict) return { output_ref: item.output_ref, status: 'PENDING', error: 'Conflicting Output operation is still active' };
  const op = reconcileOutputOperation(result.operation);
  return { output_ref: item.output_ref, status: op?.phase || 'PENDING', error: op?.error || null, operation_id: op?.id || null };
}

function stopServe(session, item, options) {
  const id = outputService.parseServeOutputId(item.output_ref);
  if (!id) return null;
  if (Number(id) !== Number(session.stream_id)) return { output_ref: item.output_ref, status: 'FAILED', error: 'SERVE Output belongs to another Room' };
  const result = outputService.startOrStopServe(session.stream_id, 'STOPPED', { idempotency_key: closeKey(session.id, 'network', item.output_ref), requested_by: requestedBy(options) });
  if (result.conflict) return { output_ref: item.output_ref, status: 'PENDING', error: 'Conflicting SERVE operation is still active' };
  return { output_ref: item.output_ref, status: result.operation?.phase || 'PENDING', error: result.operation?.error || null, operation_id: result.operation?.id || null, boundary: 'ADMISSION_DISABLED_ONLY' };
}
function stopNetwork(session, options = {}) {
  const results = [];
  for (const item of session.outputs || []) {
    if (outputService.parseRecordOutputId(item.output_ref)) continue;
    let result = stopPush(session, item, options);
    if (!result) result = stopServe(session, item, options);
    if (!result) result = { output_ref: item.output_ref, status: 'FAILED', error: 'Unsupported Session network Output' };
    results.push(result);
  }
  return results;
}

function stopRecord(session, item, options) {
  const id = outputService.parseRecordOutputId(item.output_ref);
  if (!id) return null;
  const task = recordTaskService.getTask(id);
  if (!task || Number(task.stream_id) !== Number(session.stream_id)) return { output_ref: item.output_ref, status: 'FAILED', error: 'RECORD Output no longer belongs to this Room' };
  const result = outputService.startOrStopRecord(id, 'STOPPED', { idempotency_key: closeKey(session.id, 'record', item.output_ref), requested_by: requestedBy(options) });
  if (result.conflict) return { output_ref: item.output_ref, status: 'PENDING', error: 'Conflicting RECORD operation is still active' };
  const op = reconcileOutputOperation(result.operation);
  return { output_ref: item.output_ref, status: op?.phase || 'PENDING', error: op?.error || null, operation_id: op?.id || null, runtime_state: recordTaskService.getTask(id)?.runtime_state || null };
}

function stopRecords(session, options = {}) {
  return (session.outputs || []).map(item => stopRecord(session, item, options)).filter(Boolean);
}
function summarize(results = []) {
  const failed = results.filter(item => item.status === 'FAILED');
  const pending = results.filter(item => !['SUCCEEDED','FAILED','CANCELLED'].includes(item.status));
  return { total: results.length, pending: pending.length, failed: failed.length, results };
}

function stopManagedPull(session) {
  const task = pullTaskService.getTaskByStream(session.stream_id);
  if (!task) return { present: false, done: true, desired_state: null, runtime_state: null };
  if (task.desired_state !== 'STOPPED') pullTaskService.setDesiredState(task.id, 'STOPPED');
  const fresh = pullTaskService.getTaskByStream(session.stream_id);
  return { present: true, done: fresh.runtime_state === 'STOPPED', desired_state: fresh.desired_state, runtime_state: fresh.runtime_state, task_id: fresh.id };
}

function serveBoundary(session) {
  const policy = outPullService.getPolicy(session.stream_id);
  return {
    admission_enabled: Boolean(policy?.endpoint_enabled),
    existing_sessions_not_force_disconnected: true,
    direct_hls_not_policy_controlled: true,
    external_ingest_action: 'UNCHANGED'
  };
}

function failureResult(operation, session, stage, detail) {
  const result = { stage, residual: detail, boundary: serveBoundary(session), session_state: 'CLOSING' };
  return operationCore.transition(operation.id, 'FAILED', { result, error: `Session closing failed at ${stage}` });
}
function reconcileSessionCloseOperation(operation, options = {}) {
  if (!operation || operation.type !== 'V3_SESSION_CLOSE' || operation.subject_type !== 'session') return operation;
  if (TERMINAL.has(operation.phase)) return operation;
  const session = sessionService.getSession(operation.subject_id);
  if (!session) return operationCore.transition(operation.id, 'FAILED', { error: 'Session no longer exists' });
  if (session.lifecycle_state === 'ENDED') return operationCore.transition(operation.id, 'SUCCEEDED', { result: { stage: 'ENDED', session_state: 'ENDED', boundary: serveBoundary(session) } });
  if (session.lifecycle_state !== 'CLOSING') return operationCore.transition(operation.id, 'FAILED', { error: `Session close cannot continue from ${session.lifecycle_state}` });

  const network = stopNetwork(session, options);
  const networkSummary = summarize(network);
  if (networkSummary.failed) return failureResult(operation, session, 'NETWORK', networkSummary);
  if (networkSummary.pending) {
    if (ageMs(operation) > CLOSE_TIMEOUT_MS) return failureResult(operation, session, 'NETWORK_TIMEOUT', networkSummary);
    return operation;
  }

  const records = stopRecords(session, options);
  const recordSummary = summarize(records);
  if (recordSummary.failed) return failureResult(operation, session, 'RECORD', recordSummary);
  if (recordSummary.pending) {
    if (ageMs(operation) > CLOSE_TIMEOUT_MS) return failureResult(operation, session, 'RECORD_TIMEOUT', recordSummary);
    return operation;
  }

  const pull = stopManagedPull(session);
  if (!pull.done) {
    if (ageMs(operation) > CLOSE_TIMEOUT_MS) return failureResult(operation, session, 'PULL_TIMEOUT', pull);
    return operation;
  }

  const ended = sessionService.transition(session.id, 'ENDED');
  return operationCore.transition(operation.id, 'SUCCEEDED', { result: { stage: 'ENDED', session_state: ended.lifecycle_state, network: networkSummary, records: recordSummary, pull, boundary: serveBoundary(ended) } });
}
function closeSession(sessionId, options = {}) {
  let session = sessionService.getSession(sessionId);
  if (!session) throw new Error('Session not found');
  const existing = operationCore.findIdempotent('V3_SESSION_CLOSE', 'session', session.id, options.idempotency_key);
  if (existing) return { operation: reconcileSessionCloseOperation(existing, options), reused: true };
  if (!['ON_AIR','CLOSING'].includes(session.lifecycle_state)) throw new Error(`Session cannot close from ${session.lifecycle_state}`);
  const created = operationCore.createOrReuse({
    type: 'V3_SESSION_CLOSE', subject_type: 'session', subject_id: session.id,
    idempotency_key: options.idempotency_key, requested_by: requestedBy(options),
    payload: { session_id: session.id, boundary: { external_ingest_action: 'UNCHANGED' } }
  });
  if (created.conflict || created.reused) return created;
  operationCore.transition(created.operation.id, 'RUNNING');
  if (session.lifecycle_state === 'ON_AIR') session = sessionService.transition(session.id, 'CLOSING');
  const verifying = operationCore.transition(created.operation.id, 'VERIFYING', { result: { stage: 'NETWORK', session_state: session.lifecycle_state, boundary: serveBoundary(session) } });
  return { operation: reconcileSessionCloseOperation(verifying, options), reused: false };
}

module.exports = {
  CLOSE_TIMEOUT_MS, closeKey, stopNetwork, stopRecords, stopManagedPull,
  closeSession, reconcileSessionCloseOperation, summarize, serveBoundary
};
