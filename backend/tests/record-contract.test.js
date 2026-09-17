const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'srs-manager-record-contract-'));
process.env.DATA_DIR = dataDir;
process.env.RECORD_STORAGE_ROOT = path.join(dataDir, 'recordings');

const db = require('../database');
const templateService = require('../services/transcode-service');
const renditionService = require('../services/v3-rendition-service');
const bindingService = require('../services/transcode-binding-service');
const pushTaskService = require('../services/push-task-service');
const recordTaskService = require('../services/record-task-service');
const assetService = require('../services/record-asset-service');
const storageService = require('../services/record-storage-service');
const recordRuntime = require('../services/record-runtime');

function createTemplate(name, vcodec, acodec) {
  return templateService.createTemplate({ name, vcodec, acodec,
    video_config: JSON.stringify(vcodec === 'none' ? {} : { width: 1280, height: 720, fps: 25, bitrate: 3000, gop_seconds: 2 }),
    audio_config: JSON.stringify({ bitrate: 128, sample_rate: 48000, channels: 2 }), enabled: 1 });
}
test('record storage keeps relative paths inside the configured root and reports disk budget', () => {
  assert.equal(storageService.normalizeSubdir('news/2026-09-17'), 'news/2026-09-17');
  assert.throws(() => storageService.normalizeSubdir('../escape'), /Invalid recording subdir/);
  assert.throws(() => storageService.resolveRelative('../escape.ts'), /escapes storage root/);
  const budget = storageService.diskBudget(8_000_000, {
    statfs: () => ({ bsize: 4096, blocks: 1_000_000, bavail: 500_000 }),
    reserveRatio: 0.1, minReserveBytes: 0
  });
  assert.equal(budget.low_space, false);
  assert.ok(budget.estimated_seconds > 0);
});

test('record tasks enforce audio-only matching Renditions', () => {
  const streamId = Number(db.prepare("INSERT INTO streams (name, protocol) VALUES ('record-audio', 'rtmp')").run().lastInsertRowid);
  const video = createTemplate('video-aac', 'h264', 'aac');
  const audio = createTemplate('audio-aac', 'none', 'aac');
  const videoBinding = renditionService.ensureRendition(streamId, video.id).binding;
  const audioBinding = renditionService.ensureRendition(streamId, audio.id).binding;
  assert.throws(() => recordTaskService.createTask({ stream_id: streamId, name: 'bad', format: 'audio', audio_format: 'aac' }), /audio-only Rendition/);
  assert.throws(() => recordTaskService.createTask({ stream_id: streamId, source_binding_id: videoBinding.id, name: 'bad2', format: 'audio', audio_format: 'aac' }), /audio-only Rendition/);
  const task = recordTaskService.createTask({ stream_id: streamId, source_binding_id: audioBinding.id, name: 'radio', format: 'audio', audio_format: 'aac' });
  assert.equal(task.source_binding_id, audioBinding.id);
  assert.equal(task.audio_format, 'aac');
});
test('MP4 contract captures recoverable TS segments before copy-finalize', () => {
  const streamId = Number(db.prepare("INSERT INTO streams (name, protocol) VALUES ('record-mp4', 'rtmp')").run().lastInsertRowid);
  const task = recordTaskService.createTask({ stream_id: streamId, name: 'evening-news', format: 'mp4', subdir: 'news', segment_seconds: 4 });
  const asset = assetService.createAsset(task, { now: new Date('2026-09-17T10:00:00Z'), nonce: 'fixed' });
  assert.equal(path.isAbsolute(asset.work_dir), false);
  assert.equal(path.isAbsolute(asset.final_path), false);
  const paths = assetService.resolveAssetPaths(asset, { createWorkDir: true });
  assert.ok(paths.work_dir.startsWith(storageService.storageRoot()));
  const capture = recordRuntime.buildCaptureArgs('rtmp://127.0.0.1/live/program', paths.work_dir, task);
  assert.ok(capture.includes('segment'));
  assert.ok(capture.some(value => String(value).endsWith('segment-%06d.ts')));
  const finalize = recordRuntime.buildFinalizeArgs(paths.concat_file, paths.final_path, task);
  assert.deepEqual(finalize.slice(-3), ['-movflags', '+faststart', paths.final_path]);
  fs.writeFileSync(path.join(paths.work_dir, 'segment-000000.ts'), Buffer.alloc(100));
  fs.writeFileSync(path.join(paths.work_dir, 'segment-000001.ts'), Buffer.alloc(200));
  const observed = assetService.refreshObserved(asset.id);
  assert.equal(observed.asset.segment_count, 2);
  assert.equal(observed.asset.size_bytes, 300);
});
test('RECORD is a shared Rendition consumer and prevents premature teardown', () => {
  const streamId = Number(db.prepare("INSERT INTO streams (name, protocol) VALUES ('record-shared', 'rtmp')").run().lastInsertRowid);
  const profile = createTemplate('shared-720p', 'h264', 'aac');
  const binding = renditionService.ensureRendition(streamId, profile.id).binding;
  const push = pushTaskService.createTask({ stream_id: streamId, source_binding_id: binding.id, target_type: 'test', target_url: 'rtmp://10.30.5.199/live/record-shared-out' });
  const record = recordTaskService.createTask({ stream_id: streamId, source_binding_id: binding.id, name: 'archive', format: 'mp4' });

  pushTaskService.setDesiredState(push.id, 'RUNNING');
  renditionService.reconcileDesiredState(binding.id);
  recordTaskService.setDesiredState(record.id, 'RUNNING');
  assert.equal(renditionService.runningConsumers(binding.id), 2);
  assert.equal(bindingService.getBinding(binding.id).desired_state, 'RUNNING');

  pushTaskService.setDesiredState(push.id, 'STOPPED');
  renditionService.reconcileDesiredState(binding.id);
  assert.equal(renditionService.runningConsumers(binding.id), 1);
  assert.equal(bindingService.getBinding(binding.id).desired_state, 'RUNNING');

  recordTaskService.setDesiredState(record.id, 'STOPPED');
  assert.equal(renditionService.runningConsumers(binding.id), 0);
  assert.equal(bindingService.getBinding(binding.id).desired_state, 'STOPPED');
  assert.throws(() => bindingService.deleteBinding(binding.id), /still referenced/);
});

test.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
