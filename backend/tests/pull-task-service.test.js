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
    VALUES ('partner-primary', 'rtmp://primary.example.test/live/source', 'rtmp', 'pull')
  `).run();
  const backup = db.prepare(`
    INSERT INTO external_sources (name, source_url, protocol, pull_mode)
    VALUES ('partner-backup', 'rtmp://backup.example.test/live/source', 'rtmp', 'pull')
  `).run();
  return {
    streamId: Number(stream.lastInsertRowid),
    sourceId: Number(source.lastInsertRowid),
    backupId: Number(backup.lastInsertRowid)
  };
}

test('PullTask separates desired/runtime state, manages source sets, and enforces worker lease ownership', (t) => {
  const { streamId, sourceId, backupId } = seed();

  t.after(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const task = pullTaskService.createTask({ stream_id: streamId, external_source_id: sourceId });
  assert.equal(task.desired_state, 'STOPPED');
  assert.equal(task.runtime_state, 'STOPPED');
  assert.equal(task.active_source_id, sourceId);
  assert.equal(task.source_url, undefined);
  assert.equal(task.sources.length, 1);
  assert.equal(task.sources[0].priority, 1);
  assert.equal(task.sources[0].external_source_id, sourceId);
  assert.equal(task.sources[0].source_url, undefined);

  const internal = pullTaskService.getTask(task.id, { includeSecret: true });
  assert.ok(internal.source_url.includes('primary.example.test'));
  assert.ok(internal.sources[0].source_url.includes('primary.example.test'));

  const withBackup = pullTaskService.addTaskSource(task.id, backupId);
  assert.equal(withBackup.sources.length, 2);
  assert.equal(withBackup.sources[1].priority, 2);
  assert.equal(withBackup.sources[1].external_source_id, backupId);

  const next = pullTaskService.getNextEnabledSource(task.id, sourceId);
  assert.equal(next.external_source_id, backupId);
  assert.ok(next.source_url.includes('backup.example.test'));

  const switched = pullTaskService.switchActiveSource(task.id, backupId, 'primary exhausted');
  assert.equal(switched.active_source_id, backupId);
  assert.equal(switched.source_name, 'partner-backup');
  assert.equal(switched.attempt, 0);
  assert.equal(switched.runtime_state, 'RETRYING');
  assert.equal(switched.last_source_switch_reason, 'primary exhausted');
  assert.equal(pullTaskService.ensureUsableActiveSource(task.id).active_source_id, backupId, 'usable backup must not auto-failback');

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
  assert.equal(requested.runtime_state, 'RETRYING', 'switch state remains runtime evidence until worker reconciles');
  assert.throws(() => pullTaskService.updateTaskSource(task.id, backupId, { enabled: 0 }), /cannot be disabled/);
  assert.throws(() => pullTaskService.deleteTaskSource(task.id, backupId), /cannot be removed/);

  pullTaskService.updateRuntime(task.id, { runtime_state: 'RUNNING', worker_instance_id: 'worker-a', attempt: 1 });
  assert.throws(() => pullTaskService.deleteTask(task.id), /must be stopped/);

  pullTaskService.setDesiredState(task.id, 'STOPPED');
  pullTaskService.updateRuntime(task.id, { runtime_state: 'STOPPED', worker_instance_id: null, attempt: 0 });

  // Removing the active source must be atomic: if every remaining candidate is
  // disabled, reject before deleting anything.
  pullTaskService.updateTaskSource(task.id, sourceId, { enabled: 0 });
  assert.throws(() => pullTaskService.deleteTaskSource(task.id, backupId), /no enabled source/);
  assert.equal(pullTaskService.getTask(task.id).sources.length, 2, 'failed removal must not partially mutate the source set');
  pullTaskService.updateTaskSource(task.id, sourceId, { enabled: 1 });
  const afterRemoval = pullTaskService.deleteTaskSource(task.id, backupId);
  assert.equal(afterRemoval.active_source_id, sourceId, 'stopped task should atomically select the next usable source');
  assert.equal(afterRemoval.sources.length, 1);

  assert.deepEqual(pullTaskService.deleteTask(task.id), { id: task.id, stream_id: streamId });
});
