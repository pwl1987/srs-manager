const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'srs-manager-hooks-access-'));
process.env.DATA_DIR = dataDir;
process.env.JWT_SECRET = 'hooks-access-preview-secret';

const db = require('../database');
const outPullService = require('../services/out-pull-service');
const internalMediaService = require('../services/internal-media-service');
const hooksRouter = require('../routes/hooks');

function startApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/hooks', hooksRouter);
  return new Promise(resolve => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function hook(server, action, body) {
  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/api/hooks/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return { status: response.status, body: await response.json() };
}
test('SRS on_play enforces OUT-PULL admission and grants without affecting unmanaged streams', async (t) => {
  const server = await startApp();
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const stream = db.prepare("INSERT INTO streams (name, protocol, status) VALUES ('secure-play', 'rtmp', 'online')").run();
  const streamId = Number(stream.lastInsertRowid);
  outPullService.updatePolicy(streamId, { require_grant: true });

  const denied = await hook(server, 'on_play', { stream: 'secure-play', client_id: 'client-denied', ip: '1.2.3.4' });
  assert.equal(denied.status, 200);
  assert.equal(denied.body.code, 403);
  assert.equal(db.prepare("SELECT viewers FROM streams WHERE id = ?").get(streamId).viewers, 0);

  const grant = outPullService.createGrant(streamId, {
    label: 'partner',
    expires_at: new Date(Date.now() + 3600000).toISOString()
  });
  const allowed = await hook(server, 'on_play', {
    stream: 'secure-play',
    client_id: 'client-allowed',
    ip: '1.2.3.4',
    param: `?access_token=${grant.token}`
  });
  assert.equal(allowed.body.code, 0);
  assert.equal(db.prepare("SELECT viewers FROM streams WHERE id = ?").get(streamId).viewers, 1);
  assert.equal(outPullService.activeSessions(streamId).length, 1);

  const unmanaged = await hook(server, 'on_play', { stream: 'legacy-unmanaged', client_id: 'legacy-player' });
  assert.equal(unmanaged.body.code, 0);

  await hook(server, 'on_stop', { stream: 'secure-play', client_id: 'client-allowed' });
  assert.equal(outPullService.activeSessions(streamId).length, 0);

  outPullService.updatePolicy(streamId, { endpoint_enabled: false, accepting_new_sessions: false, require_grant: true });
  const internalToken = internalMediaService.getInternalMediaToken();
  const internal = await hook(server, 'on_play', {
    stream: 'secure-play', client_id: 'client-internal', param: `?internal_media_token=${internalToken}`
  });
  assert.equal(internal.body.code, 0);
  assert.equal(db.prepare('SELECT viewers FROM streams WHERE id = ?').get(streamId).viewers, 0);
  assert.equal(outPullService.nonAudienceClientIds(streamId).has('client-internal'), true);

  await hook(server, 'on_stop', { stream: 'secure-play', client_id: 'client-internal' });
  assert.equal(outPullService.nonAudienceClientIds(streamId).size, 0);
});
