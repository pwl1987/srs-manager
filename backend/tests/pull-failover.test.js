const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'srs-manager-pull-failover-'));
process.env.DATA_DIR = dataDir;

const db = require('../database');
const pullTaskService = require('../services/pull-task-service');
const { decidePullFailure } = require('../services/pull-failover-policy');

function seed() {
  const stream = db.prepare("INSERT INTO streams (name, protocol, status) VALUES ('failover-news', 'rtmp', 'offline')").run();
  const primary = db.prepare(`
    INSERT INTO external_sources (name, source_url, protocol, pull_mode)
    VALUES ('primary-source', 'rtmp://primary.example.test/live/news', 'rtmp', 'pull')
  `).run();
  const backup = db.prepare(`
    INSERT INTO external_sources (name, source_url, protocol, pull_mode)
    VALUES ('backup-source', 'rtmp://backup.example.test/live/news', 'rtmp', 'pull')
  `).run();
  return {
    streamId: Number(stream.lastInsertRowid),
    primaryId: Number(primary.lastInsertRowid),
    backupId: Number(backup.lastInsertRowid)
  };
}

test('PullTask source set preserves priority and active source without auto-failback', () => {
  const { streamId, primaryId, backupId } = seed();
  const task = pullTaskService.createTask({ stream_id: streamId, external_source_id: primaryId });

  assert.equal(task.active_source_id, primaryId);
  assert.equal(task.sources.length, 1);
  assert.equal(task.sources[0].priority, 1);
  assert.equal(task.sources[0].external_source_id, primaryId);
  assert.equal(task.sources[0].source_url, undefined);

  const withBackup = pullTaskService.addTaskSource(task.id, backupId);
  assert.equal(withBackup.sources.length, 2);
  assert.equal(withBackup.sources[1].priority, 2);
  assert.equal(withBackup.sources[1].external_source_id, backupId);

  const next = pullTaskService.getNextEnabledSource(task.id, primaryId);
  assert.equal(next.external_source_id, backupId);
  assert.ok(next.source_url.includes('backup.example.test'));

  const switched = pullTaskService.switchActiveSource(task.id, backupId, 'primary exhausted');
  assert.equal(switched.active_source_id, backupId);
  assert.equal(switched.source_name, 'backup-source');
  assert.equal(switched.attempt, 0);
  assert.equal(switched.runtime_state, 'RETRYING');
  assert.equal(switched.last_source_switch_reason, 'primary exhausted');

  const stableBackup = pullTaskService.ensureUsableActiveSource(task.id);
  assert.equal(stableBackup.active_source_id, backupId, 'usable backup must not auto-failback to priority 1');

  pullTaskService.setDesiredState(task.id, 'RUNNING');
  assert.throws(
    () => pullTaskService.updateTaskSource(task.id, backupId, { enabled: 0 }),
    /cannot be disabled/
  );
  assert.throws(
    () => pullTaskService.deleteTaskSource(task.id, backupId),
    /cannot be removed/
  );
});

test('Pull failover policy advances only toward fallbacks and preserves single-source retry budget', () => {
  const sources = [
    { external_source_id: 10, priority: 1, enabled: true, source_status: 'active' },
    { external_source_id: 20, priority: 2, enabled: true, source_status: 'active' }
  ];

  assert.deepEqual(
    decidePullFailure({ attempt: 2, maxAttempts: 8, sourceMaxAttempts: 3, sources, activeSourceId: 10 }),
    { action: 'retry' }
  );
  assert.deepEqual(
    decidePullFailure({ attempt: 3, maxAttempts: 8, sourceMaxAttempts: 3, sources, activeSourceId: 10 }),
    { action: 'failover', next_source_id: 20 }
  );
  assert.deepEqual(
    decidePullFailure({ attempt: 3, maxAttempts: 8, sourceMaxAttempts: 3, sources, activeSourceId: 20 }),
    { action: 'failed', reason: 'all_sources_exhausted' }
  );
  assert.deepEqual(
    decidePullFailure({ attempt: 7, maxAttempts: 8, sourceMaxAttempts: 3, sources: [sources[0]], activeSourceId: 10 }),
    { action: 'retry' }
  );
  assert.deepEqual(
    decidePullFailure({ attempt: 8, maxAttempts: 8, sourceMaxAttempts: 3, sources: [sources[0]], activeSourceId: 10 }),
    { action: 'failed', reason: 'attempts_exhausted' }
  );
});

test.after(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});
