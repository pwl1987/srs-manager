const outputService = require('./v3-output-service');
const pushTaskService = require('./push-task-service');
const recordTaskService = require('./record-task-service');
const operationCore = require('./v3-operation-core');
const sessionService = require('./session-service');
const preflightService = require('./preflight-service');

function requestedBy(options) { return options.requested_by || null; }
function childKey(sessionId, outputRef) { return `session:${sessionId}:start:${outputRef}`; }

function launchOutput(session, item, options = {}) {
  const key = childKey(session.id, item.output_ref);
  let result;
  const pushId = outputService.parsePushOutputId(item.output_ref);
  const serveId = outputService.parseServeOutputId(item.output_ref);
  const recordId = outputService.parseRecordOutputId(item.output_ref);
  if (pushId) {
    const task = pushTaskService.getTask(pushId);
    if (!task || Number(task.stream_id) !== Number(session.stream_id)) throw new Error('PUSH Output no longer belongs to this Session Room');
    result = outputService.startOrStopPush(pushId, 'RUNNING', { idempotency_key: key, requested_by: requestedBy(options) });
  } else if (recordId) {
    const task = recordTaskService.getTask(recordId);
    if (!task || Number(task.stream_id) !== Number(session.stream_id)) throw new Error('RECORD Output no longer belongs to this Session Room');
    result = outputService.startOrStopRecord(recordId, 'RUNNING', { idempotency_key: key, requested_by: requestedBy(options) });
  } else if (serveId && Number(serveId) === Number(session.stream_id)) {
    result = outputService.startOrStopServe(session.stream_id, 'RUNNING', { idempotency_key: key, requested_by: requestedBy(options) });
  } else {
    throw new Error(`Unsupported Session Output: ${item.output_ref}`);
  }
  if (result.conflict) {
    return { output_ref: item.output_ref, importance: item.importance, status: 'FAILED', error: 'A conflicting Output operation is already active.', operation_id: result.operation?.id || null, conflict: true };
  }
  return { output_ref: item.output_ref, importance: item.importance, status: result.operation?.phase || 'QUEUED', error: null, operation_id: result.operation?.id || null, reused: Boolean(result.reused) };
}

function reconcileChild(child) {
  if (!child.operation_id || child.conflict || child.error) return child;
  let operation = operationCore.getOperation(child.operation_id);
  if (!operation) return { ...child, status: 'FAILED', error: 'Child Output operation disappeared.' };
  if (operation.subject_type === 'forward_task') operation = outputService.reconcilePushOperation(operation);
  else if (operation.subject_type === 'record_task') operation = outputService.reconcileRecordOperation(operation);
  return { ...child, status: operation.phase, error: operation.error || null, operation_id: operation.id };
}

function summarize(children) {
  const terminal = new Set(['SUCCEEDED', 'FAILED', 'CANCELLED']);
  const pending = children.filter(x => !terminal.has(x.status));
  const failed = children.filter(x => ['FAILED', 'CANCELLED'].includes(x.status));
  const requiredFailed = failed.filter(x => x.importance === 'REQUIRED');
  const optionalFailed = failed.filter(x => x.importance === 'OPTIONAL');
  return {
    pending: pending.length,
    failed: failed.length,
    required_failed: requiredFailed.length,
    optional_failed: optionalFailed.length,
    degraded: failed.length > 0,
    failed_outputs: failed.map(x => ({ output_ref: x.output_ref, importance: x.importance, error: x.error || x.status }))
  };
}

async function startSession(sessionId, options = {}) {
  let session = sessionService.getSession(sessionId);
  if (!session) throw new Error('Session not found');
  const existing = operationCore.findIdempotent('V3_SESSION_START', 'session', session.id, options.idempotency_key);
  if (existing) return { operation: reconcileSessionStartOperation(existing), reused: true };
  if (['ON_AIR', 'CLOSING', 'ENDED'].includes(session.lifecycle_state)) throw new Error(`Session cannot start from ${session.lifecycle_state}`);
  const created = operationCore.createOrReuse({ type: 'V3_SESSION_START', subject_type: 'session', subject_id: session.id, idempotency_key: options.idempotency_key, requested_by: requestedBy(options), payload: { session_id: session.id } });
  if (created.conflict || created.reused) return created;
  operationCore.transition(created.operation.id, 'RUNNING');
  try {
    const preflight = await preflightService.evaluateSession(session.id, { workspace: options.workspace, mark_ready: true });
    session = sessionService.getSession(session.id);
    if (preflight.status === 'BLOCKED') {
      return { operation: operationCore.transition(created.operation.id, 'FAILED', { result: { preflight }, error: 'Session Preflight is blocked' }), reused: false };
    }
    const children = [];
    for (const item of session.outputs.filter(x => x.auto_start)) {
      try { children.push(launchOutput(session, item, options)); }
      catch (error) { children.push({ output_ref: item.output_ref, importance: item.importance, status: 'FAILED', error: error.message, operation_id: null }); }
    }
    const result = { preflight, children, summary: summarize(children) };
    const verifying = operationCore.transition(created.operation.id, 'VERIFYING', { result });
    return { operation: reconcileSessionStartOperation(verifying), reused: false };
  } catch (error) {
    return { operation: operationCore.transition(created.operation.id, 'FAILED', { error: error.message }), reused: false };
  }
}

function reconcileSessionStartOperation(operation) {
  if (!operation || operation.type !== 'V3_SESSION_START' || operation.subject_type !== 'session') return operation;
  if (['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(operation.phase)) return operation;
  const session = sessionService.getSession(operation.subject_id);
  if (!session) return operationCore.transition(operation.id, 'FAILED', { error: 'Session no longer exists' });
  const previous = operation.result || {};
  const children = (previous.children || []).map(reconcileChild);
  const summary = summarize(children);
  const result = { ...previous, children, summary };
  if (summary.pending > 0) return operationCore.transition(operation.id, 'VERIFYING', { result });
  let fresh = session;
  if (fresh.lifecycle_state === 'PREP') fresh = sessionService.transition(fresh.id, 'READY');
  if (fresh.lifecycle_state === 'READY') fresh = sessionService.transition(fresh.id, 'ON_AIR');
  return operationCore.transition(operation.id, 'SUCCEEDED', { result: { ...result, session_state: fresh.lifecycle_state } });
}

module.exports = { childKey, launchOutput, reconcileChild, summarize, startSession, reconcileSessionStartOperation };
