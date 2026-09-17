const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'srs-manager-push-task-'));
process.env.DATA_DIR = dataDir;

const db = require('../database');
const pushTaskService = require('../services/push-task-service');

test('OUT-PUSH separates desired/runtime state, masks target secrets and owns one worker lease', (t) => {
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const stream = db.prepare("INSERT INTO streams (name, protocol, status) VALUES ('push-news', 'rtmp', 'offline')").run();
  const streamId = Number(stream.lastInsertRowid);
  const target = 'rtmp://user:pass@platform.example.org/live/key?token=abc123';

  const task = pushTaskService.createTask({ stream_id: streamId, target_type: 'customRtmp', target_url: target });
  assert.equal(task.desired_state, 'STOPPED');
  assert.equal(task.runtime_state, 'STOPPED');
  assert.equal(task.target_url, undefined);
  assert.ok(task.target_url_masked.includes('platform.example.org/live/key'));
  assert.ok(!task.target_url_masked.includes('pass'));
  assert.ok(!task.target_url_masked.includes('abc123'));

  const internal = pushTaskService.getTask(task.id, { includeSecret: true });
  assert.equal(internal.target_url, target);

  const started = pushTaskService.setDesiredState(task.id, 'RUNNING');
  assert.equal(started.desired_state, 'RUNNING');
  assert.equal(started.runtime_state, 'WAITING_INPUT');
  assert.throws(() => pushTaskService.updateTask(task.id, { target_url: 'rtmp://other.example.org/live/key' }), /Stop OUT-PUSH/);

  pushTaskService.updateRuntime(task.id, { runtime_state: 'RUNNING', worker_instance_id: 'push-a', attempt: 1 });
  const stopped = pushTaskService.setDesiredState(task.id, 'STOPPED');
  assert.equal(stopped.desired_state, 'STOPPED');
  assert.equal(stopped.runtime_state, 'STOPPING');
  pushTaskService.updateRuntime(task.id, { runtime_state: 'STOPPED', worker_instance_id: null });

  assert.equal(pushTaskService.claimWorkerLease('push-a', 10000).acquired, true);
  assert.equal(pushTaskService.claimWorkerLease('push-b', 10000).acquired, false);
  assert.equal(pushTaskService.renewWorkerLease('push-b'), false);
  assert.equal(pushTaskService.renewWorkerLease('push-a'), true);
  pushTaskService.clearWorkerHeartbeat('push-a');
  assert.equal(pushTaskService.claimWorkerLease('push-b', 10000).acquired, true);
  pushTaskService.clearWorkerHeartbeat('push-b');

  assert.deepEqual(pushTaskService.deleteTask(task.id), { id: task.id });
});
