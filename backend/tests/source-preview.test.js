const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'srs-manager-source-preview-'));
process.env.DATA_DIR = dataDir;
process.env.JWT_SECRET = 'source-preview-test-secret';
const db = require('../database');
const pullTaskService = require('../services/pull-task-service');
const sourcePreview = require('../services/source-preview-service');
const access = require('../services/preview-access-service');

test('source preview is room/source bound and only resolves enabled IN-PULL sources', (t) => {
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const roomA = Number(db.prepare("INSERT INTO streams(name,protocol,status) VALUES('room-a','rtmp','offline')").run().lastInsertRowid);
  const roomB = Number(db.prepare("INSERT INTO streams(name,protocol,status) VALUES('room-b','rtmp','offline')").run().lastInsertRowid);
  const sourceId = Number(db.prepare("INSERT INTO external_sources(name,source_url,protocol,status) VALUES('cam','rtsp://user:secret@camera.test/live?token=hidden','rtsp','active')").run().lastInsertRowid);
  const task = pullTaskService.createTask({ stream_id: roomA, external_source_id: sourceId });
  const source = pullTaskService.getTask(task.id).sources[0];
  const v3Id = `source:in_pull:ptsrc-${source.id}`;
  const resolved = sourcePreview.resolvePullSource(roomA, v3Id);
  assert.equal(resolved.external_source_id, sourceId);
  assert.equal(sourcePreview.resolvePullSource(roomB, v3Id), null);
  const args = sourcePreview.buildArgs(resolved);
  assert.deepEqual(args.slice(0, 6), ['-nostdin','-hide_banner','-loglevel','error','-rtsp_transport','tcp']);
  assert.ok(args.includes('pipe:1'));
  assert.ok(args.includes('-c:v'));
  pullTaskService.updateTaskSource(task.id, sourceId, { enabled: false });
  assert.equal(sourcePreview.resolvePullSource(roomA, v3Id), null);

  const stream = { id: roomA, name: 'room-a' };
  const issued = access.issueSourcePreviewToken(stream, v3Id);
  assert.equal(issued.preferred_transport, 'http-flv');
  assert.equal(access.verifySourcePreviewToken(issued.token, stream, v3Id), true);
  assert.equal(access.verifySourcePreviewToken(issued.token, stream, 'source:in_pull:ptsrc-999'), false);
  assert.equal(access.verifySourcePreviewToken(issued.token, { id: roomB, name: 'room-b' }, v3Id), false);
});
