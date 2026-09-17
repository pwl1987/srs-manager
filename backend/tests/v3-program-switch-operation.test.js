const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'srs-manager-v3-switch-'));
process.env.DATA_DIR = dataDir;
const db = require('../database');
const pullTaskService = require('../services/pull-task-service');
const operationService = require('../services/operation-service');

test('V3 pull Program switch reuses Idempotency-Key and conflicts with a different active switch', (t) => {
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const streamId = Number(db.prepare("INSERT INTO streams(name,protocol,status) VALUES('news','rtmp','offline')").run().lastInsertRowid);
  const a = Number(db.prepare("INSERT INTO external_sources(name,source_url,protocol,status) VALUES('a','rtmp://a.test/live/a','rtmp','active')").run().lastInsertRowid);
  const b = Number(db.prepare("INSERT INTO external_sources(name,source_url,protocol,status) VALUES('b','rtmp://b.test/live/b','rtmp','active')").run().lastInsertRowid);
  let task = pullTaskService.createTask({ stream_id: streamId, external_source_id: a });
  task = pullTaskService.addTaskSource(task.id, b, 2);
  pullTaskService.setDesiredState(task.id, 'RUNNING');
  const first = operationService.requestPullSourceSwitch(task.id, b, 'tester', 'switch-key-1');
  const replay = operationService.requestPullSourceSwitch(task.id, b, 'tester', 'switch-key-1');
  assert.equal(replay.id, first.id);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM operations').get().n, 1);
  assert.throws(() => operationService.requestPullSourceSwitch(task.id, b, 'tester', 'switch-key-2'), /already in progress/);
});
