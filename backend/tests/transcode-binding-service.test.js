const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'srs-manager-transcode-binding-'));
process.env.DATA_DIR = dataDir;

const db = require('../database');
const templateService = require('../services/transcode-service');
const bindingService = require('../services/transcode-binding-service');

test('transcode binding supports multi-output desired/runtime state and one worker lease', (t) => {
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const streamId = Number(db.prepare("INSERT INTO streams (name, protocol) VALUES ('news', 'rtmp')").run().lastInsertRowid);
  const main = templateService.createTemplate({
    name: '1080 Main', vcodec: 'h264', acodec: 'aac',
    video_config: JSON.stringify({ width: 1920, height: 1080, fps: 25, bitrate: 6000, gop_seconds: 2 }),
    audio_config: JSON.stringify({ bitrate: 192 }), enabled: 1
  });
  const audio = templateService.createTemplate({
    name: 'Audio', vcodec: 'none', acodec: 'aac',
    video_config: '{}', audio_config: JSON.stringify({ bitrate: 128 }), enabled: 1
  });  const mainBinding = bindingService.createBinding({ stream_id: streamId, template_id: main.id, role: 'main', output_suffix: 'main', sort_order: 10 });
  const audioBinding = bindingService.createBinding({ stream_id: streamId, template_id: audio.id, role: 'audio', output_suffix: 'audio', sort_order: 30 });
  assert.equal(mainBinding.output_stream_name, 'news__main');
  assert.equal(audioBinding.output_stream_name, 'news__audio');
  assert.equal(bindingService.listBindingsByStream(streamId).length, 2);
  assert.throws(() => bindingService.createBinding({ stream_id: streamId, template_id: main.id, output_suffix: 'main' }), /UNIQUE constraint failed/);

  const started = bindingService.setDesiredState(mainBinding.id, 'RUNNING');
  assert.equal(started.desired_state, 'RUNNING');
  assert.equal(started.runtime_state, 'WAITING_INPUT');
  assert.throws(() => bindingService.updateBinding(mainBinding.id, { output_suffix: 'primary' }), /Stop transcode output/);
  bindingService.updateRuntime(mainBinding.id, { runtime_state: 'RUNNING', worker_instance_id: 'tc-a', attempt: 1 });
  const stopped = bindingService.setDesiredState(mainBinding.id, 'STOPPED');
  assert.equal(stopped.runtime_state, 'STOPPING');
  bindingService.updateRuntime(mainBinding.id, { runtime_state: 'STOPPED', worker_instance_id: null });

  assert.equal(bindingService.claimWorkerLease('tc-a', 10000).acquired, true);
  assert.equal(bindingService.claimWorkerLease('tc-b', 10000).acquired, false);
  assert.equal(bindingService.renewWorkerLease('tc-b'), false);
  assert.equal(bindingService.renewWorkerLease('tc-a'), true);
  bindingService.clearWorkerHeartbeat('tc-a');
  assert.equal(bindingService.claimWorkerLease('tc-b', 10000).acquired, true);
  bindingService.clearWorkerHeartbeat('tc-b');

  assert.deepEqual(bindingService.deleteBinding(mainBinding.id), { id: mainBinding.id, output_stream_name: 'news__main' });
  assert.deepEqual(bindingService.deleteBinding(audioBinding.id), { id: audioBinding.id, output_stream_name: 'news__audio' });
});