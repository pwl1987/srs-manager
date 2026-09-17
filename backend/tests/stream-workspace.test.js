const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'srs-manager-test-'));
process.env.DATA_DIR = dataDir;

const db = require('../database');
const srsService = require('../services/srs');
const cdnService = require('../services/cdn-service');
const streamService = require('../services/stream-service');
const pullTaskService = require('../services/pull-task-service');
const pushTaskService = require('../services/push-task-service');
const outPullService = require('../services/out-pull-service');
const transcodeService = require('../services/transcode-service');
const transcodeBindingService = require('../services/transcode-binding-service');
const workspaceService = require('../services/stream-workspace-service');

const originals = {
  listClients: srsService.listClients,
  getStreams: srsService.getStreams,
  kickClient: srsService.kickClient,
  getBatchState: cdnService.getBatchState
};

function seedStream() {
  db.prepare('DELETE FROM out_pull_sessions').run();
  db.prepare('DELETE FROM access_grants').run();
  db.prepare('DELETE FROM out_pull_policies').run();
  db.prepare('DELETE FROM forward_tasks').run();
  db.prepare('DELETE FROM distribution_requests').run();
  db.prepare('DELETE FROM cdn_channels').run();
  db.prepare('DELETE FROM pull_tasks').run();
  db.prepare('DELETE FROM external_sources').run();
  db.prepare('DELETE FROM streams').run();
  const result = db.prepare("INSERT INTO streams (name, protocol, status) VALUES ('news-main', 'rtmp', 'online')").run();
  return Number(result.lastInsertRowid);
}

test('scoped controls and workspace keep publisher/player and managed-pull semantics separate', async (t) => {
  const streamId = seedStream();
  // Current SRS client API returns an internal stream id in `stream` and the
  // business app/name in `url`. Keep this fixture aligned with real SRS output.
  const clients = [
    { id: 11, stream: 'vid-publisher', url: '/live/news-main', type: 'fmle-publish', ip: '10.0.0.10', protocol: 'rtmp' },
    { id: 12, stream: 'vid-news', url: '/live/news-main', type: 'play', ip: '10.0.0.20' },
    { id: 13, stream: 'vid-news', url: '/live/news-main.flv', type: 'hls-play', ip: '10.0.0.21' },
    { id: 99, stream: 'vid-other', url: '/live/other-stream', type: 'play', ip: '10.0.0.99' }
  ];

  const kicked = [];
  srsService.listClients = async () => clients;
  srsService.kickClient = async (id) => { kicked.push(id); return { ok: true }; };
  srsService.getStreams = async () => [{
    id: 'vid-stream-main', name: 'news-main', app: 'live', vhost: 'vid-vhost', live_ms: Date.now() - 65000,
    clients: 3, frames: 1800, recv_bytes: 123456, send_bytes: 654321, kbps: { recv_30s: 7200 },
    video: { codec: 'H264', profile: 'High', level: '4.1', width: 1920, height: 1080 },
    audio: { codec: 'AAC', profile: 'LC', sample_rate: 48000, channel: 2 }
  }, {
    id: 'vid-derived-main', name: 'news-main__main', app: 'live', live_ms: Date.now() - 30000,
    clients: 1, frames: 750, recv_bytes: 65432, send_bytes: 1234, kbps: { recv_30s: 5600 },
    video: { codec: 'H264', profile: 'High', level: '4', width: 1920, height: 1080 },
    audio: { codec: 'AAC', profile: 'LC', sample_rate: 48000, channel: 2 }
  }];
  cdnService.getBatchState = async () => [{ channel_id: 'cdn-1', is_live: true, bitrate: 6800, viewers: 40 }];

  t.after(() => {
    Object.assign(srsService, {
      listClients: originals.listClients,
      getStreams: originals.getStreams,
      kickClient: originals.kickClient
    });
    cdnService.getBatchState = originals.getBatchState;
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const publisherResult = await streamService.disconnectPublisher(streamId);
  assert.deepEqual(kicked, [11], 'publisher disconnect must not actively kick playback clients');
  assert.equal(publisherResult.scope, 'publisher');
  assert.equal(publisherResult.disconnected, 1);

  kicked.length = 0;
  const viewersResult = await streamService.disconnectViewers(streamId);
  assert.deepEqual(kicked.sort((a, b) => a - b), [12, 13], 'viewer disconnect must not kick the publisher');
  assert.equal(viewersResult.scope, 'viewers');
  assert.equal(viewersResult.disconnected, 2);

  const template = transcodeService.createTemplate({
    name: 'Main 1080', vcodec: 'h264', acodec: 'aac',
    video_config: JSON.stringify({ width: 1920, height: 1080, fps: 25, bitrate: 6000, gop_seconds: 2 }),
    audio_config: JSON.stringify({ bitrate: 192 }), output_format: 'rtmp', enabled: 1
  });
  const transcode = transcodeBindingService.createBinding({
    stream_id: streamId, template_id: template.id, role: 'main', output_suffix: 'main', sort_order: 10
  });
  transcodeBindingService.setDesiredState(transcode.id, 'RUNNING');
  transcodeBindingService.updateRuntime(transcode.id, { runtime_state: 'RUNNING', worker_instance_id: 'tc-worker-a', attempt: 1 });
  assert.equal(transcodeBindingService.claimWorkerLease('tc-worker-a', 10000).acquired, true);

  const pushTask = pushTaskService.createTask({
    stream_id: streamId,
    target_type: 'custom_rtmp',
    target_url: 'rtmp://partner.example.org/live/news-main?token=hidden',
    enabled: 1
  });
  pushTaskService.updateRuntime(pushTask.id, { runtime_state: 'RUNNING', worker_instance_id: 'push-worker-a', attempt: 1 });
  assert.equal(pushTaskService.claimWorkerLease('push-worker-a', 10000).acquired, true);
  outPullService.updatePolicy(streamId, { require_grant: true });
  db.prepare(`INSERT INTO cdn_channels (stream_id, channel_name, channel_id, push_domain)
    VALUES (?, 'news-main-cdn', 'cdn-1', 'push.example.test')`).run(streamId);
  db.prepare(`INSERT INTO distribution_requests (stream_id, applicant, expires_at, status)
    VALUES (?, 'partner-a', '2099-01-01T00:00:00.000Z', 'active')`).run(streamId);

  const source = db.prepare(`
    INSERT INTO external_sources (name, source_url, protocol, pull_mode, status)
    VALUES ('partner-ingest', 'rtmp://example.com/live/input', 'rtmp', 'pull', 'active')
  `).run();
  const pullTask = pullTaskService.createTask({ stream_id: streamId, external_source_id: Number(source.lastInsertRowid) });
  pullTaskService.setDesiredState(pullTask.id, 'RUNNING');
  pullTaskService.updateRuntime(pullTask.id, { runtime_state: 'RUNNING', worker_instance_id: 'worker-a', attempt: 1 });
  assert.equal(pullTaskService.claimWorkerLease('worker-a', 10000).acquired, true);

  const workspace = await workspaceService.getWorkspace(streamId);
  assert.equal(workspace.observed.online, true);
  assert.equal(workspace.observed.publisher.id, 11);
  assert.equal(workspace.observed.players.count, 2);
  assert.equal(workspace.observed.media.stream_id, 'vid-stream-main');
  assert.equal(workspace.observed.media.video.codec, 'H264');
  assert.equal(workspace.observed.media.video.width, 1920);
  assert.equal(workspace.observed.media.audio.codec, 'AAC');
  assert.equal(workspace.observed.media.audio.sample_rate, 48000);
  assert.ok(workspace.observed.uptime_seconds >= 60 && workspace.observed.uptime_seconds <= 70);
  assert.equal(workspace.processing.transcodes.length, 1);
  assert.equal(workspace.processing.transcodes[0].runtime_state, 'RUNNING');
  assert.equal(workspace.processing.transcodes[0].observed.online, true);
  assert.equal(workspace.processing.transcodes[0].observed.media.video.width, 1920);
  assert.equal(workspace.processing.worker.available, true);
  assert.equal(workspace.outputs.forwards.length, 1);
  assert.equal(workspace.outputs.forwards[0].runtime_state, 'RUNNING');
  assert.equal(workspace.outputs.forwards[0].target_url, undefined);
  assert.ok(!workspace.outputs.forwards[0].target_url_masked.includes('hidden'));
  assert.equal(workspace.outputs.push_worker.available, true);
  assert.equal(workspace.outputs.out_pull.policy.require_grant, true);
  assert.equal(workspace.outputs.cdn_channels[0].remote_state, 'live');
  assert.equal(workspace.distribution.length, 1);
  assert.equal(workspace.capabilities.disconnect_publisher, true);
  assert.equal(workspace.capabilities.disconnect_viewers, true);
  assert.equal(workspace.capabilities.in_pull_runtime, true);
  assert.equal(workspace.capabilities.out_push_runtime, true);
  assert.equal(workspace.capabilities.transcode_runtime, true);
  assert.equal(workspace.capabilities.out_pull_policy, true);
  assert.equal(workspace.inputs.managed_pull.worker.available, true);
  assert.equal(workspace.inputs.managed_pull.task.id, pullTask.id);
  assert.equal(workspace.inputs.managed_pull.task.source_url, undefined);
  assert.equal(workspace.inputs.managed_pull.observed_publisher, true);
  pushTaskService.clearWorkerHeartbeat('push-worker-a');
  transcodeBindingService.clearWorkerHeartbeat('tc-worker-a');
});
