const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'srs-manager-phase06-start-'));
process.env.DATA_DIR = dataDir;
process.env.RECORD_STORAGE_ROOT = path.join(dataDir, 'recordings');

const db = require('../database');
const pushTaskService = require('../services/push-task-service');
const recordTaskService = require('../services/record-task-service');
const runPlanService = require('../services/run-plan-service');
const sessionService = require('../services/session-service');
const orchestration = require('../services/session-orchestration-service');
const operationCore = require('../services/v3-operation-core');

function room(name) { return Number(db.prepare('INSERT INTO streams (name, protocol) VALUES (?, ?)').run(name, 'rtmp').lastInsertRowid); }
function workspace(streamId, outputs, extra = {}) {
  return { evidence: { srs: { available: true } }, sources: [{ id: `source:in_push:legacy-${streamId}`, availability: 'ONLINE' }], outputs,
    capabilities: { runtime: { push_worker: { available: true }, record: { available: true, storage: { low_space: false } }, transcode_worker: { available: true } } }, ...extra };
}

test('Session Start is idempotent and reaches ON_AIR after required child Output succeeds', async () => {
  const streamId = room('session-start-ok');
  const push = pushTaskService.createTask({ stream_id: streamId, target_type: 'test', target_url: 'rtmp://10.30.5.199/live/session-start-ok-out' });
  const plan = runPlanService.createPlan({ stream_id: streamId, name: 'Start Plan', program_source_id: `source:in_push:legacy-${streamId}`, outputs: [{ output_ref: `output:push:${push.id}`, importance: 'REQUIRED', auto_start: true }] });
  const session = sessionService.createSession({ stream_id: streamId, run_plan_id: plan.id, title: 'Start Session' });
  const first = await orchestration.startSession(session.id, { idempotency_key: 'session-start-ok-key', workspace: workspace(streamId, [{ id: `output:push:${push.id}`, mode: 'PUSH', media_ref: 'rendition:program-original', control_mode: 'MANAGED' }]) });
  assert.equal(first.operation.phase, 'VERIFYING');
  assert.equal(pushTaskService.getTask(push.id).desired_state, 'RUNNING');
  pushTaskService.updateRuntime(push.id, { runtime_state: 'RUNNING', worker_instance_id: 'test-push-worker' });
  const done = orchestration.reconcileSessionStartOperation(operationCore.getOperation(first.operation.id));
  assert.equal(done.phase, 'SUCCEEDED');
  assert.equal(sessionService.getSession(session.id).lifecycle_state, 'ON_AIR');
  const repeated = await orchestration.startSession(session.id, { idempotency_key: 'session-start-ok-key', workspace: workspace(streamId, []) });
  assert.equal(repeated.reused, true);
  assert.equal(repeated.operation.id, done.id);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM operations WHERE type='V3_OUTPUT_START' AND subject_id=?").get(push.id).c, 1);
});

test('Session Start keeps healthy outputs running when an optional Output fails', async () => {
  const streamId = room('session-start-degraded');
  const push = pushTaskService.createTask({ stream_id: streamId, target_type: 'test', target_url: 'rtmp://10.30.5.199/live/session-start-degraded-out' });
  const record = recordTaskService.createTask({ stream_id: streamId, name: 'optional-record', format: 'mp4' });
  const plan = runPlanService.createPlan({ stream_id: streamId, name: 'Degraded Plan', program_source_id: `source:in_push:legacy-${streamId}`, outputs: [
    { output_ref: `output:push:${push.id}`, importance: 'REQUIRED', auto_start: true },
    { output_ref: `output:record:${record.id}`, importance: 'OPTIONAL', auto_start: true }
  ]});
  const session = sessionService.createSession({ stream_id: streamId, run_plan_id: plan.id, title: 'Degraded Session' });
  const ws = workspace(streamId, [
    { id: `output:push:${push.id}`, mode: 'PUSH', media_ref: 'rendition:program-original', control_mode: 'MANAGED' },
    { id: `output:record:${record.id}`, mode: 'RECORD', media_ref: 'rendition:program-original' }
  ]);
  const started = await orchestration.startSession(session.id, { idempotency_key: 'session-degraded-key', workspace: ws });
  pushTaskService.updateRuntime(push.id, { runtime_state: 'RUNNING', worker_instance_id: 'test-push-worker' });
  recordTaskService.updateRuntime(record.id, { runtime_state: 'FAILED', last_error: 'synthetic recorder failure' });
  const done = orchestration.reconcileSessionStartOperation(operationCore.getOperation(started.operation.id));
  assert.equal(done.phase, 'SUCCEEDED');
  assert.equal(done.result.summary.degraded, true);
  assert.equal(done.result.summary.optional_failed, 1);
  assert.equal(done.result.summary.required_failed, 0);
  assert.equal(sessionService.getSession(session.id).lifecycle_state, 'ON_AIR');
  assert.equal(pushTaskService.getTask(push.id).desired_state, 'RUNNING');
});

test('Blocked Preflight prevents Session Start from mutating child Output state', async () => {
  const streamId = room('session-start-blocked');
  const push = pushTaskService.createTask({ stream_id: streamId, target_type: 'test', target_url: 'rtmp://10.30.5.199/live/session-start-blocked-out' });
  const plan = runPlanService.createPlan({ stream_id: streamId, name: 'Blocked Plan', program_source_id: `source:in_push:legacy-${streamId}`, outputs: [{ output_ref: `output:push:${push.id}`, importance: 'REQUIRED', auto_start: true }] });
  const session = sessionService.createSession({ stream_id: streamId, run_plan_id: plan.id, title: 'Blocked Session' });
  pushTaskService.deleteTask(push.id);
  const started = await orchestration.startSession(session.id, { idempotency_key: 'session-blocked-key', workspace: workspace(streamId, []) });
  assert.equal(started.operation.phase, 'FAILED');
  assert.equal(sessionService.getSession(session.id).lifecycle_state, 'PREP');
  assert.equal(db.prepare("SELECT COUNT(*) c FROM operations WHERE subject_type = 'forward_task' AND subject_id = ?").get(push.id).c, 0);
});

test.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
