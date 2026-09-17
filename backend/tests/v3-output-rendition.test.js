const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'srs-manager-v3-output-'));
process.env.DATA_DIR = dataDir;

const db = require('../database');
const templateService = require('../services/transcode-service');
const bindingService = require('../services/transcode-binding-service');
const pushTaskService = require('../services/push-task-service');
const renditionService = require('../services/v3-rendition-service');
const outputService = require('../services/v3-output-service');

function createProfile(name, width = 1280) {
  return templateService.createTemplate({
    name, vcodec: 'h264', acodec: 'aac',
    video_config: JSON.stringify({ width, height: 720, fps: 25, bitrate: 3000, gop_seconds: 2 }),
    audio_config: JSON.stringify({ bitrate: 128, sample_rate: 48000, channels: 2 }),
    enabled: 1
  });
}
test('V3 outputs share one canonical Rendition and stop it only after the last consumer', (t) => {
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const streamId = Number(db.prepare("INSERT INTO streams (name, protocol) VALUES ('v3-news', 'rtmp')").run().lastInsertRowid);
  const profileA = createProfile('720P A');
  const profileB = createProfile('720P B');

  const first = renditionService.ensureRendition(streamId, profileA.id);
  const second = renditionService.ensureRendition(streamId, profileB.id);
  assert.equal(first.reused, false);
  assert.equal(second.reused, true);
  assert.equal(second.binding.id, first.binding.id);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM stream_transcode_bindings WHERE stream_id = ?').get(streamId).count, 1);

  const outA = outputService.createPushOutput(streamId, {
    name: 'Platform A', scene: 'LIVE_PLATFORM_PUSH', transport: 'rtmp', protection: 'none',
    processing: { mode: 'RENDITION', template_id: profileA.id },
    destination: { kind: 'CUSTOM', label: 'Platform A', target_url: 'rtmp://10.30.5.199/live/a' }
  });
  const outB = outputService.createPushOutput(streamId, {
    name: 'CDN B', scene: 'CDN_PUSH', transport: 'rtmp', protection: 'none',
    processing: { mode: 'RENDITION', template_id: profileB.id },
    destination: { kind: 'CUSTOM', label: 'CDN B', target_url: 'rtmp://10.30.5.199/live/b' }
  });
  assert.equal(outA.task.source_binding_id, first.binding.id);
  assert.equal(outB.task.source_binding_id, first.binding.id);
  assert.equal(outA.task.source_stream_name, outB.task.source_stream_name);

  const startA = outputService.startOrStopPush(outA.task.id, 'RUNNING', { idempotency_key: 'start-a', requested_by: 'test' });
  assert.equal(startA.operation.phase, 'VERIFYING');
  assert.equal(pushTaskService.getTask(outA.task.id).desired_state, 'RUNNING');
  assert.equal(bindingService.getBinding(first.binding.id).desired_state, 'RUNNING');
  const replay = outputService.startOrStopPush(outA.task.id, 'RUNNING', { idempotency_key: 'start-a', requested_by: 'test' });
  assert.equal(replay.reused, true);

  outputService.startOrStopPush(outB.task.id, 'RUNNING', { idempotency_key: 'start-b', requested_by: 'test' });
  assert.equal(renditionService.runningConsumers(first.binding.id), 2);

  pushTaskService.updateRuntime(outA.task.id, { runtime_state: 'RUNNING', worker_instance_id: 'push-test' });
  const completedA = outputService.reconcilePushOperation(startA.operation);
  assert.equal(completedA.phase, 'SUCCEEDED');

  const stopA = outputService.startOrStopPush(outA.task.id, 'STOPPED', { idempotency_key: 'stop-a', requested_by: 'test' });
  assert.equal(renditionService.runningConsumers(first.binding.id), 1);
  assert.equal(bindingService.getBinding(first.binding.id).desired_state, 'RUNNING');
  pushTaskService.updateRuntime(outA.task.id, { runtime_state: 'STOPPED', worker_instance_id: null });
  assert.equal(outputService.reconcilePushOperation(stopA.operation).phase, 'SUCCEEDED');
  pushTaskService.updateRuntime(outB.task.id, { runtime_state: 'RUNNING', worker_instance_id: 'push-test' });
  const startB = outputService.startOrStopPush(outB.task.id, 'RUNNING', { idempotency_key: 'start-b', requested_by: 'test' });
  assert.equal(startB.reused, true);
  const activeStartB = require('../services/v3-operation-core').findIdempotent('V3_OUTPUT_START', 'forward_task', outB.task.id, 'start-b');
  assert.equal(outputService.reconcilePushOperation(activeStartB).phase, 'SUCCEEDED');

  assert.throws(() => bindingService.deleteBinding(first.binding.id), /still referenced by an output/);

  const stopB = outputService.startOrStopPush(outB.task.id, 'STOPPED', { idempotency_key: 'stop-b', requested_by: 'test' });
  assert.equal(renditionService.runningConsumers(first.binding.id), 0);
  assert.equal(bindingService.getBinding(first.binding.id).desired_state, 'STOPPED');
  pushTaskService.updateRuntime(outB.task.id, { runtime_state: 'STOPPED', worker_instance_id: null });
  assert.equal(outputService.reconcilePushOperation(stopB.operation).phase, 'SUCCEEDED');

  const deletedA = outputService.deletePushOutput(outA.task.id);
  assert.equal(deletedA.rendition_deleted, false);
  const deletedB = outputService.deletePushOutput(outB.task.id);
  assert.equal(deletedB.rendition_deleted, true);
  assert.equal(bindingService.getBinding(first.binding.id), null);
});

test('legacy managed PUSH without a Rendition keeps Program Original as its input', () => {
  const streamId = Number(db.prepare("INSERT INTO streams (name, protocol) VALUES ('legacy-program', 'rtmp')").run().lastInsertRowid);
  const task = pushTaskService.createTask({ stream_id: streamId, target_type: 'legacy-compatible', target_url: 'rtmp://10.30.5.199/live/legacy' });
  assert.equal(task.source_binding_id, null);
  assert.equal(task.source_stream_name, 'legacy-program');
  assert.equal(task.v3_metadata, null);
});