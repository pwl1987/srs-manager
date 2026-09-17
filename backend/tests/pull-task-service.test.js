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

test('PullTask separates desired/runtime state and never exposes source secret by default', (t) => {
  const { streamId, sourceId } = seed();

  t.after(() => {
    db.close();
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

  const requested = pullTaskService.setDesiredState(task.id, 'RUNNING');
  assert.equal(requested.desired_state, 'RUNNING');
  assert.equal(requested.runtime_state, 'STOPPED', 'API request must not fake a running runtime state');

  pullTaskService.updateRuntime(task.id, { runtime_state: 'RUNNING', worker_instance_id: 'worker-a', attempt: 1 });
  assert.throws(() => pullTaskService.deleteTask(task.id), /must be stopped/);

  pullTaskService.setDesiredState(task.id, 'STOPPED');
  pullTaskService.updateRuntime(task.id, { runtime_state: 'STOPPED', worker_instance_id: null, attempt: 0 });
  assert.deepEqual(pullTaskService.deleteTask(task.id), { id: task.id, stream_id: streamId });
});
