const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'srs-manager-pull-task-'));
process.env.DATA_DIR = dataDir;

const db = require('../database');
const pullTaskService = require('../services/pull-task-service');

function seed() {
  const stream = db.prepare("INSERT INTO streams (name, protocol, status) VALUES ('pull-news', 'rtmp', 'offline')").run();
  const source = db.prepare(`
    INSERT INTO external_sources (name, source_url, protocol, pull_mode)
    VALUES ('partner-source', 'rtmp://user:password@example.com/live/source?token=super-secret', 'rtmp', 'pull')
  `).run();
  return { streamId: Number(stream.lastInsertRowid), sourceId: Number(source.lastInsertRowid) };
}

test('PullTask separates desired/runtime state, masks secrets, and enforces worker lease ownership', (t) => {
  const { streamId, sourceId } = seed();

  t.after(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const task = pullTaskService.createTask({ stream_id: streamId, external_source_id: sourceId });
  assert.equal(task.desired_state, 'STOPPED');
  assert.equal(task.runtime_state, 'STOPPED');
  assert.equal(task.source_url, undefined);
  assert.ok(task.source_url_masked.includes('example.com/live/source'));
  assert.ok(!task.source_url_masked.includes('password'));
  assert.ok(!task.source_url_masked.includes('super-secret'));

  const internal = pullTaskService.getTask(task.id, { includeSecret: true });
  assert.ok(internal.source_url.includes('super-secret'));

  assert.equal(pullTaskService.getWorkerHealth().available, false);

  const firstLease = pullTaskService.claimWorkerLease('worker-a', 10000);
  assert.equal(firstLease.acquired, true);
  assert.equal(firstLease.instance_id, 'worker-a');

  const healthy = pullTaskService.getWorkerHealth(10000);
  assert.equal(healthy.available, true);
  assert.equal(healthy.instance_id, 'worker-a');
  assert.ok(healthy.last_seen_at);

  const competingLease = pullTaskService.claimWorkerLease('worker-b', 10000);
  assert.equal(competingLease.acquired, false);
  assert.equal(competingLease.instance_id, 'worker-a');
  assert.equal(pullTaskService.renewWorkerLease('worker-b'), false, 'non-owner must not renew the lease');
  assert.equal(pullTaskService.renewWorkerLease('worker-a'), true, 'lease owner should renew successfully');

  pullTaskService.clearWorkerHeartbeat('worker-b');
  assert.equal(pullTaskService.getWorkerHealth().available, true, 'another worker must not clear the active lease');
  pullTaskService.clearWorkerHeartbeat('worker-a');
  assert.equal(pullTaskService.getWorkerHealth().available, false);

  const takeover = pullTaskService.claimWorkerLease('worker-b', 10000);
  assert.equal(takeover.acquired, true, 'standby worker may acquire after the owner releases the lease');
  assert.equal(takeover.instance_id, 'worker-b');
  pullTaskService.clearWorkerHeartbeat('worker-b');

  const requested = pullTaskService.setDesiredState(task.id, 'RUNNING');
  assert.equal(requested.desired_state, 'RUNNING');
  assert.equal(requested.runtime_state, 'STOPPED', 'API request must not fake a running runtime state');

  pullTaskService.updateRuntime(task.id, { runtime_state: 'RUNNING', worker_instance_id: 'worker-a', attempt: 1 });
  assert.throws(() => pullTaskService.deleteTask(task.id), /must be stopped/);

  pullTaskService.setDesiredState(task.id, 'STOPPED');
  pullTaskService.updateRuntime(task.id, { runtime_state: 'STOPPED', worker_instance_id: null, attempt: 0 });
  assert.deepEqual(pullTaskService.deleteTask(task.id), { id: task.id, stream_id: streamId });
});
