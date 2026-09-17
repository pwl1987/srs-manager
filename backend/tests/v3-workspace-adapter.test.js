const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'srs-manager-v3-adapter-'));
process.env.DATA_DIR = dataDir;

const db = require('../database');
const srsService = require('../services/srs');
const cdnService = require('../services/cdn-service');
const pullTaskService = require('../services/pull-task-service');
const pushTaskService = require('../services/push-task-service');
const transcodeService = require('../services/transcode-service');
const transcodeBindingService = require('../services/transcode-binding-service');
const v3 = require('../services/v3-workspace-service');

const originals = {
  getStreams: srsService.getStreams,
  listClients: srsService.listClients,
  getBatchState: cdnService.getBatchState
};

function resetData() {
  for (const table of [
    'out_pull_sessions', 'access_grants', 'out_pull_policies', 'operations',
    'stream_transcode_bindings', 'transcode_templates', 'forward_tasks',
    'distribution_requests', 'cdn_channels', 'pull_task_sources', 'pull_tasks',
    'external_sources', 'hook_events', 'streams'
  ]) db.prepare(`DELETE FROM ${table}`).run();
  db.prepare("DELETE FROM settings WHERE key LIKE 'runtime.%'").run();
}

function seedStream(name = 'news-main') {
  const result = db.prepare('INSERT INTO streams (name, protocol, status) VALUES (?, ?, ?)')
    .run(name, 'rtmp', 'offline');
  return Number(result.lastInsertRowid);
}

function liveStream(name = 'news-main') {
  return {
    id: `srs-${name}`, name, app: 'live', live_ms: Date.now() - 60000,
    clients: 1, frames: 1000, recv_bytes: 12345, send_bytes: 23456,
    kbps: { recv_30s: 8100 },
    video: { codec: 'H264', profile: 'High', width: 1920, height: 1080 },
    audio: { codec: 'AAC', sample_rate: 48000, channel: 2 }
  };
}

function collectKeys(value, out = []) {
  if (Array.isArray(value)) value.forEach(item => collectKeys(item, out));
  else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) { out.push(key); collectKeys(child, out); }
  }
  return out;
}

test('V3 read adapter reconciles current V2 facts without changing runtime ownership', async (t) => {
  t.after(() => {
    srsService.getStreams = originals.getStreams;
    srsService.listClients = originals.listClients;
    cdnService.getBatchState = originals.getBatchState;
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  resetData();
  let streamId = seedStream();
  srsService.getStreams = async () => [liveStream()];
  srsService.listClients = async () => [
    { id: 'pub-external', stream: 'opaque', url: '/live/news-main', type: 'fmle-publish', ip: '10.0.0.9', protocol: 'rtmp' }
  ];
  cdnService.getBatchState = async () => [];

  let aggregate = await v3.getWorkspace(`room:${streamId}`);
  assert.equal(aggregate.room.id, `room:${streamId}`);
  assert.equal(aggregate.session, null);
  assert.equal(aggregate.program.state, 'LIVE');
  assert.equal(aggregate.program.attribution, 'EXTERNAL_PUSH_OBSERVED');
  assert.equal(aggregate.program.source_id, `source:in_push:legacy-${streamId}`);
  assert.equal(aggregate.sources.find(x => x.kind === 'IN_PUSH').role, 'PROGRAM');
  assert.equal(aggregate.health.status, 'NORMAL');
  assert.equal(aggregate.capabilities.phase, '02');
  assert.equal(aggregate.capabilities.runtime.record.available, false);
  assert.equal(aggregate.outputs.find(x => x.mode === 'SERVE').runtime_state, 'AVAILABLE');

  resetData();
  streamId = seedStream();
  const srcA = Number(db.prepare("INSERT INTO external_sources (name, source_url, protocol, status) VALUES ('pull-a','rtmp://user:pass@example.test/live/a?token=secret','rtmp','active')").run().lastInsertRowid);
  const srcB = Number(db.prepare("INSERT INTO external_sources (name, source_url, protocol, status) VALUES ('pull-b','srt://example.test:9000?passphrase=hidden','srt','active')").run().lastInsertRowid);
  let pull = pullTaskService.createTask({ stream_id: streamId, external_source_id: srcA });
  pull = pullTaskService.addTaskSource(pull.id, srcB, 2);
  pullTaskService.setDesiredState(pull.id, 'RUNNING');
  pullTaskService.updateRuntime(pull.id, { runtime_state: 'RUNNING', worker_instance_id: 'pull-worker-v3', attempt: 1 });
  assert.equal(pullTaskService.claimWorkerLease('pull-worker-v3', 10000).acquired, true);
  srsService.getStreams = async () => [liveStream()];
  srsService.listClients = async () => [
    { id: 'pub-managed', stream: 'opaque', url: '/live/news-main', type: 'fmle-publish', ip: '127.0.0.1', protocol: 'rtmp' }
  ];

  aggregate = await v3.getWorkspace(streamId);
  const activePull = aggregate.sources.find(x => x.compatibility?.external_source_id === srcA);
  assert.ok(activePull);
  assert.equal(activePull.role, 'PROGRAM');
  assert.equal(activePull.availability, 'ONLINE');
  assert.equal(aggregate.program.source_id, activePull.id);
  assert.equal(aggregate.program.attribution, 'MANAGED_PULL_VERIFIED');
  assert.notEqual(aggregate.sources.find(x => x.kind === 'IN_PUSH').role, 'PROGRAM');
  const standby = aggregate.sources.find(x => x.compatibility?.external_source_id === srcB);
  assert.equal(standby.role, 'STANDBY');
  assert.equal(standby.availability, 'UNKNOWN', 'unprobed standby must not be invented as READY');
  assert.ok(standby.source_url_masked);
  assert.equal(standby.source_url_masked.includes('hidden'), false);
  assert.equal(standby.source_url_masked.includes('passphrase='), false);

  resetData();
  streamId = seedStream();
  const template = transcodeService.createTemplate({
    name: '1080P', vcodec: 'libx264', acodec: 'aac',
    video_config: JSON.stringify({ width: 1920, height: 1080, fps: 25, bitrate: 6000, gop_seconds: 2 }),
    audio_config: JSON.stringify({ bitrate: 192, sample_rate: 48000, channels: 2 }), enabled: 1
  });
  const binding = transcodeBindingService.createBinding({ stream_id: streamId, template_id: template.id, role: 'main', output_suffix: 'main' });
  transcodeBindingService.setDesiredState(binding.id, 'RUNNING');
  transcodeBindingService.updateRuntime(binding.id, { runtime_state: 'RUNNING', worker_instance_id: 'tc-v3' });
  transcodeBindingService.claimWorkerLease('tc-v3', 10000);
  const push = pushTaskService.createTask({ stream_id: streamId, target_type: 'video_platform', target_url: 'rtmp://push.example/live/key?token=topsecret', enabled: 1 });
  pushTaskService.updateRuntime(push.id, { runtime_state: 'RUNNING', worker_instance_id: 'push-v3' });
  pushTaskService.claimWorkerLease('push-v3', 10000);
  db.prepare(`INSERT INTO cdn_channels (stream_id, channel_name, channel_id, push_domain) VALUES (?, 'Wangsu News', 'cdn-v3', 'push.cdn.test')`).run(streamId);
  srsService.getStreams = async () => [liveStream()];
  srsService.listClients = async () => [{ id: 'pub-3', stream: 'opaque', url: '/live/news-main', type: 'fmle-publish', ip: '10.0.0.3', protocol: 'rtmp' }];
  cdnService.getBatchState = async () => [{ channel_id: 'cdn-v3', is_live: true, bitrate: 7000, viewers: 88 }];

  const runtimeFingerprintBefore = {
    forward: db.prepare('SELECT id, desired_state, runtime_state, worker_instance_id FROM forward_tasks ORDER BY id').all(),
    transcode: db.prepare('SELECT id, desired_state, runtime_state, worker_instance_id FROM stream_transcode_bindings ORDER BY id').all(),
    pull: db.prepare('SELECT id, desired_state, runtime_state, worker_instance_id, active_source_id FROM pull_tasks ORDER BY id').all()
  };
  aggregate = await v3.getWorkspace(streamId);
  const runtimeFingerprintAfter = {
    forward: db.prepare('SELECT id, desired_state, runtime_state, worker_instance_id FROM forward_tasks ORDER BY id').all(),
    transcode: db.prepare('SELECT id, desired_state, runtime_state, worker_instance_id FROM stream_transcode_bindings ORDER BY id').all(),
    pull: db.prepare('SELECT id, desired_state, runtime_state, worker_instance_id, active_source_id FROM pull_tasks ORDER BY id').all()
  };
  assert.deepEqual(runtimeFingerprintAfter, runtimeFingerprintBefore, 'V3 read adapter must not mutate Runtime or Desired State');
  const rendition = aggregate.renditions.find(x => x.compatibility?.stream_transcode_binding_id === binding.id);
  assert.equal(rendition.runtime_state, 'RUNNING');
  assert.equal(rendition.observed.online, false, 'runtime RUNNING must not invent derived media observation');
  const pushOutput = aggregate.outputs.find(x => x.mode === 'PUSH');
  assert.equal(pushOutput.runtime_state, 'RUNNING');
  assert.equal(pushOutput.evidence.local.level, 'RUNTIME');
  assert.equal(pushOutput.evidence.remote.state, 'UNKNOWN');
  assert.ok(!pushOutput.destination.target_url_masked.includes('topsecret'));
  assert.equal(aggregate.outputs.some(x => x.name === 'Wangsu News'), false, 'provider config alone is not a runtime Output');
  assert.equal(aggregate.compatibility.provider_channels[0].remote_state, 'live');
  assert.equal(aggregate.compatibility.provider_channels[0].runtime_claim, false);

  db.prepare(`INSERT INTO forward_tasks (stream_id, target_type, target_url, enabled, execution_mode, desired_state, runtime_state, status)
    VALUES (?, 'legacy', 'rtmp://legacy.example/live/key', 1, 'srs_dynamic', 'RUNNING', 'LEGACY_DYNAMIC', 'legacy_dynamic')`).run(streamId);
  aggregate = await v3.getWorkspace(streamId);
  const legacyPush = aggregate.outputs.find(x => x.compatibility?.execution_mode === 'srs_dynamic');
  assert.equal(legacyPush.control_mode, 'LEGACY_UNMANAGED');
  assert.equal(legacyPush.runtime_state, 'UNKNOWN');
  assert.equal(legacyPush.evidence.local.level, 'DESIRED');

  const forbidden = new Set(['source_url', 'target_url', 'token', 'token_hash', 'access_key_secret', 'password', 'passphrase']);
  for (const key of collectKeys(aggregate)) assert.equal(forbidden.has(key), false, `V3 aggregate leaked raw secret field ${key}`);

  const rooms = await v3.listRooms();
  assert.equal(rooms.length, 1);
  assert.equal(rooms[0].room.id, `room:${streamId}`);
  assert.equal(rooms[0].health.status, 'DEGRADED');
  assert.ok(rooms[0].health.reasons.some(x => x.code === 'RENDITION_MEDIA_NOT_OBSERVED'));

  // Room overview must use fresh SRS observation, never the historical DB status.
  db.prepare("UPDATE streams SET status = 'online' WHERE id = ?").run(streamId);
  srsService.getStreams = async () => [];
  srsService.listClients = async () => [];
  let reconciledRooms = await v3.listRooms();
  assert.equal(reconciledRooms[0].compatibility.legacy_stream_status, 'online');
  assert.equal(reconciledRooms[0].program.state, 'NO_PROGRAM');
  assert.equal(reconciledRooms[0].health.status, 'CRITICAL');

  srsService.getStreams = async () => { throw new Error('SRS unavailable'); };
  reconciledRooms = await v3.listRooms();
  assert.equal(reconciledRooms[0].program.state, 'UNKNOWN');
  assert.equal(reconciledRooms[0].program.evidence.freshness, 'UNKNOWN');
  assert.equal(reconciledRooms[0].health.status, 'UNKNOWN');
  aggregate = await v3.getWorkspace(streamId);
  assert.equal(aggregate.program.state, 'UNKNOWN');
  assert.equal(aggregate.program.evidence.freshness, 'UNKNOWN');
  assert.equal(aggregate.program.evidence.observed_at, null);
  assert.equal(aggregate.evidence.srs.freshness, 'UNKNOWN');
});
