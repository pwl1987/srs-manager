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
const workspaceService = require('../services/stream-workspace-service');

const originals = {
  listClients: srsService.listClients,
  getStreams: srsService.getStreams,
  kickClient: srsService.kickClient,
  getBatchState: cdnService.getBatchState
};

function seedStream() {
  db.prepare('DELETE FROM forward_tasks').run();
  db.prepare('DELETE FROM distribution_requests').run();
  db.prepare('DELETE FROM cdn_channels').run();
  db.prepare('DELETE FROM streams').run();
  const result = db.prepare("INSERT INTO streams (name, protocol, status) VALUES ('news-main', 'rtmp', 'online')").run();
  return Number(result.lastInsertRowid);
}

test('scoped controls and workspace keep publisher/player semantics separate', async (t) => {
  const streamId = seedStream();
  const clients = [
    { id: 11, app: 'live', stream: 'news-main', type: 'fmle-publish', ip: '10.0.0.10', protocol: 'rtmp' },
    { id: 12, app: 'live', stream: 'news-main', type: 'play', ip: '10.0.0.20' },
    { id: 13, app: 'live', stream: 'news-main', type: 'hls-play', ip: '10.0.0.21' },
    { id: 99, app: 'live', stream: 'other-stream', type: 'play', ip: '10.0.0.99' }
  ];

  const kicked = [];
  srsService.listClients = async () => clients;
  srsService.kickClient = async (id) => { kicked.push(id); return { ok: true }; };
  srsService.getStreams = async () => [{ name: 'news-main', app: 'live', clients: 3, kbps: { recv_30s: 7200 } }];
  cdnService.getBatchState = async () => [{ channel_id: 'cdn-1', is_live: true, bitrate: 6800, viewers: 40 }];

  t.after(() => {
    Object.assign(srsService, {
      listClients: originals.listClients,
      getStreams: originals.getStreams,
      kickClient: originals.kickClient
    });
    cdnService.getBatchState = originals.getBatchState;
    db.close();
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

  db.prepare(`INSERT INTO forward_tasks (stream_id, target_type, target_url, enabled, status)
    VALUES (?, 'custom', 'rtmp://partner/live/news-main', 1, 'idle')`).run(streamId);
  db.prepare(`INSERT INTO cdn_channels (stream_id, channel_name, channel_id, push_domain)
    VALUES (?, 'news-main-cdn', 'cdn-1', 'push.example.test')`).run(streamId);
  db.prepare(`INSERT INTO distribution_requests (stream_id, applicant, expires_at, status)
    VALUES (?, 'partner-a', '2099-01-01T00:00:00.000Z', 'active')`).run(streamId);

  const workspace = await workspaceService.getWorkspace(streamId);
  assert.equal(workspace.observed.online, true);
  assert.equal(workspace.observed.publisher.id, 11);
  assert.equal(workspace.observed.players.count, 2);
  assert.equal(workspace.outputs.forwards.length, 1);
  assert.equal(workspace.outputs.cdn_channels[0].remote_state, 'live');
  assert.equal(workspace.distribution.length, 1);
  assert.equal(workspace.capabilities.disconnect_publisher, true);
  assert.equal(workspace.capabilities.disconnect_viewers, true);
  assert.equal(workspace.capabilities.in_pull_runtime, false, 'IN-PULL must not be presented as implemented runtime');
});
