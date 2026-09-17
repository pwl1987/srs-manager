const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'srs-manager-phase07-close-'));
process.env.DATA_DIR = dataDir;
process.env.SESSION_CLOSE_TIMEOUT_MS = '2000';
const db = require('../database');
const output = require('../services/v3-output-service');
const pushTasks = require('../services/push-task-service');
const recordTasks = require('../services/record-task-service');
const pullTasks = require('../services/pull-task-service');
const sessions = require('../services/session-service');
const closing = require('../services/session-closing-service');
const ops = require('../services/v3-operation-core');

function makeOnAir() {
  const streamId = Number(db.prepare("INSERT INTO streams (name, protocol) VALUES (?, 'rtmp')").run(`closing-${Date.now()}-${Math.random()}`).lastInsertRowid);
  const push = output.createPushOutput(streamId, { mode:'PUSH', scene:'LIVE_PLATFORM_PUSH', name:'Network', transport:'rtmp', protection:'none', processing:{mode:'PASSTHROUGH'}, destination:{kind:'CUSTOM',label:'Network',target_url:'rtmp://10.30.5.199/live/close-out'} });
  const record = output.createRecordOutput(streamId, { mode:'RECORD', scene:'LOCAL_RECORD', name:'Archive', format:'mp4', processing:{mode:'PASSTHROUGH'} });
  const sourceId = Number(db.prepare("INSERT INTO external_sources (name, source_url, protocol, pull_mode, status) VALUES ('Closing Pull','rtmp://10.30.5.199/live/source','rtmp','pull','active')").run().lastInsertRowid);
  const pull = pullTasks.createTask({ stream_id:streamId, external_source_id:sourceId });
  pushTasks.setDesiredState(push.task.id, 'RUNNING');
  pushTasks.updateRuntime(push.task.id, { runtime_state:'RUNNING', worker_instance_id:'push-test' });
  recordTasks.setDesiredState(record.task.id, 'RUNNING');
  recordTasks.updateRuntime(record.task.id, { runtime_state:'RECORDING', worker_instance_id:'record-test' });
  pullTasks.setDesiredState(pull.id, 'RUNNING');
  pullTasks.updateRuntime(pull.id, { runtime_state:'RUNNING', worker_instance_id:'pull-test' });
  const sessionId = Number(db.prepare("INSERT INTO sessions (stream_id, title, lifecycle_state, plan_snapshot_json, started_at) VALUES (?, 'Closing Session', 'ON_AIR', '{}', CURRENT_TIMESTAMP)").run(streamId).lastInsertRowid);
  const insert = db.prepare("INSERT INTO session_outputs (session_id, output_ref, importance, auto_start, temporary, sort_order) VALUES (?, ?, 'REQUIRED', 1, 0, ?)");
  insert.run(sessionId, output.outputId(push.task.id), 10);
  insert.run(sessionId, output.recordOutputId(record.task.id), 20);
  return { streamId, pushId:push.task.id, recordId:record.task.id, pullId:pull.id, sessionId };
}

test('closing waits for network, then recording finalize, then managed pull before ENDED', () => {
  const x = makeOnAir();
  const started = closing.closeSession(x.sessionId, { idempotency_key:'close-sequence', requested_by:'operator' });
  assert.equal(sessions.getSession(x.sessionId).lifecycle_state, 'CLOSING');
  assert.equal(pushTasks.getTask(x.pushId).desired_state, 'STOPPED');
  assert.equal(recordTasks.getTask(x.recordId).desired_state, 'RUNNING');
  assert.equal(pullTasks.getTask(x.pullId).desired_state, 'RUNNING');
  pushTasks.updateRuntime(x.pushId, { runtime_state:'STOPPED', worker_instance_id:null });
  let op = closing.reconcileSessionCloseOperation(ops.getOperation(started.operation.id), { requested_by:'operator' });
  assert.equal(op.phase, 'VERIFYING');
  assert.equal(recordTasks.getTask(x.recordId).desired_state, 'STOPPED');
  assert.equal(recordTasks.getTask(x.recordId).runtime_state, 'STOPPING');
  assert.equal(pullTasks.getTask(x.pullId).desired_state, 'RUNNING');

  recordTasks.updateRuntime(x.recordId, { runtime_state:'COMPLETE', worker_instance_id:null });
  op = closing.reconcileSessionCloseOperation(ops.getOperation(op.id), { requested_by:'operator' });
  assert.equal(op.phase, 'VERIFYING');
  assert.equal(pullTasks.getTask(x.pullId).desired_state, 'STOPPED');
  assert.equal(sessions.getSession(x.sessionId).lifecycle_state, 'CLOSING');

  pullTasks.updateRuntime(x.pullId, { runtime_state:'STOPPED', worker_instance_id:null });
  op = closing.reconcileSessionCloseOperation(ops.getOperation(op.id), { requested_by:'operator' });
  assert.equal(op.phase, 'SUCCEEDED');
  assert.equal(sessions.getSession(x.sessionId).lifecycle_state, 'ENDED');
  assert.equal(op.result.boundary.external_ingest_action, 'UNCHANGED');
});

test('closing is idempotent and refuses unmanaged legacy network output instead of faking ENDED', () => {
  const streamId = Number(db.prepare("INSERT INTO streams (name, protocol) VALUES ('closing-legacy','rtmp')").run().lastInsertRowid);
  const task = pushTasks.createTask({ stream_id:streamId, target_type:'legacy-test', target_url:'rtmp://10.30.5.199/live/legacy-close' });
  db.prepare("UPDATE forward_tasks SET execution_mode='srs_dynamic', desired_state='RUNNING', runtime_state='LEGACY_DYNAMIC' WHERE id=?").run(task.id);
  const sessionId = Number(db.prepare("INSERT INTO sessions (stream_id, title, lifecycle_state, plan_snapshot_json) VALUES (?, 'Legacy Closing', 'ON_AIR', '{}')").run(streamId).lastInsertRowid);
  db.prepare("INSERT INTO session_outputs (session_id, output_ref, importance, auto_start) VALUES (?, ?, 'REQUIRED', 1)").run(sessionId, output.outputId(task.id));
  const first = closing.closeSession(sessionId, { idempotency_key:'legacy-close', requested_by:'operator' });
  const second = closing.closeSession(sessionId, { idempotency_key:'legacy-close', requested_by:'operator' });
  assert.equal(first.operation.id, second.operation.id);
  assert.equal(first.operation.phase, 'FAILED');
  assert.equal(sessions.getSession(sessionId).lifecycle_state, 'CLOSING');
  assert.equal(first.operation.result.stage, 'NETWORK');
});

test.after(() => fs.rmSync(dataDir, { recursive:true, force:true }));
