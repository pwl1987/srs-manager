const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const jwt = require('jsonwebtoken');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'srs-manager-meta-summary-api-'));
process.env.DATA_DIR = dataDir;
process.env.JWT_SECRET = 'test-meta-summary-secret';
process.env.SRS_API_URL = 'http://127.0.0.1:1985/api/v1';

const config = require('../../config');
const db = require('../../database');
const streamsRouter = require('../../routes/streams');
const v3Router = require('../../routes/v3');
const srsService = require('../../services/srs');

const originals = { getStreams: srsService.getStreams, listClients: srsService.listClients };
srsService.getStreams = async () => [];
srsService.listClients = async () => [];

function startApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/streams', streamsRouter);
  app.use('/api/v3', v3Router);
  return new Promise(resolve => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function request(server, pathname, init = {}) {
  const { port } = server.address();
  const token = jwt.sign({ sub: 'ci-user', role: 'admin' }, config.jwtSecret, { expiresIn: '5m' });
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers || {})
    }
  });
  const body = await response.json();
  return { response, body };
}

function seedMixedRoom() {
  const stream = db.prepare('INSERT INTO streams (name, protocol, status) VALUES (?, ?, ?)')
    .run('mixed-direction-room', 'rtmp', 'offline');
  const streamId = Number(stream.lastInsertRowid);
  db.prepare('INSERT INTO external_sources (name, source_url, protocol) VALUES (?, ?, ?)')
    .run('上游演播室', 'rtmp://upstream.example/live/a', 'rtmp');
  const source = db.prepare('SELECT id FROM external_sources ORDER BY id DESC').get();
  db.prepare('INSERT INTO pull_tasks (stream_id, external_source_id) VALUES (?, ?)').run(streamId, source.id);
  db.prepare("INSERT INTO ingest_credentials (stream_id, label, token_hash, token_hint, status) VALUES (?, ?, ?, ?, 'ACTIVE')")
    .run(streamId, '编码器A', 'hash-active', 'hint-a');
  db.prepare("INSERT INTO ingest_credentials (stream_id, label, token_hash, token_hint, status) VALUES (?, ?, ?, ?, 'REVOKED')")
    .run(streamId, '旧编码器', 'hash-revoked', 'hint-b');
  db.prepare("INSERT INTO forward_tasks (stream_id, target_type, target_url, execution_mode) VALUES (?, 'rtmp', 'rtmp://cdn.example/live/x', 'managed_worker')")
    .run(streamId);
  db.prepare("INSERT INTO forward_tasks (stream_id, target_type, target_url, execution_mode) VALUES (?, 'rtmp', 'rtmp://legacy.example/live/y', 'srs_dynamic')")
    .run(streamId);
  db.prepare("INSERT INTO record_tasks (stream_id, name, format) VALUES (?, '整场录制', 'mp4')").run(streamId);
  db.prepare('INSERT INTO out_pull_policies (stream_id, endpoint_enabled) VALUES (?, 0)').run(streamId);
  return streamId;
}

test('stream identity fields and room direction summary hold over real HTTP', async (t) => {
  const server = await startApp();
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    srsService.getStreams = originals.getStreams;
    srsService.listClients = originals.listClients;
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const created = await request(server, '/api/streams', {
    method: 'POST',
    body: JSON.stringify({ name: '向导创建的直播间', protocol: 'rtmp', remark: '  晚间新闻  ', business_unit: '新闻中心' })
  });
  assert.equal(created.response.status, 201);
  assert.equal(created.body.stream.remark, '晚间新闻');
  assert.equal(created.body.stream.business_unit, '新闻中心');

  const kept = await request(server, `/api/streams/${created.body.stream.id}`, {
    method: 'PUT',
    body: JSON.stringify({ protocol: 'srt' })
  });
  assert.equal(kept.response.status, 200);
  assert.equal(kept.body.stream.protocol, 'srt');
  assert.equal(kept.body.stream.remark, '晚间新闻');

  const cleared = await request(server, `/api/streams/${created.body.stream.id}`, {
    method: 'PUT',
    body: JSON.stringify({ remark: null, business_unit: '' })
  });
  assert.equal(cleared.response.status, 200);
  assert.equal(cleared.body.stream.remark, null);
  assert.equal(cleared.body.stream.business_unit, null);

  const tooLong = await request(server, `/api/streams/${created.body.stream.id}`, {
    method: 'PUT',
    body: JSON.stringify({ remark: '长'.repeat(201) })
  });
  assert.equal(tooLong.response.status, 400);
  assert.equal(tooLong.body.code, 'VALIDATION_STREAM_FIELD_TOO_LONG');

  const mixedStreamId = seedMixedRoom();
  const rooms = await request(server, '/api/v3/rooms');
  assert.equal(rooms.response.status, 200);
  const byName = Object.fromEntries(rooms.body.rooms.map(room => [room.room.name, room]));

  const mixed = byName['mixed-direction-room'];
  assert.deepEqual(mixed.inputs.kinds, ['IN_PUSH', 'IN_PULL']);
  assert.equal(mixed.inputs.push_credentials, 1);
  assert.equal(mixed.inputs.pull_tasks, 1);
  assert.equal(mixed.outputs.push_total, 2);
  assert.equal(mixed.outputs.serve_configured, true);
  assert.equal(mixed.outputs.serve_enabled, false);
  assert.equal(mixed.outputs.record_total, 1);
  assert.equal(mixed.outputs.configured_total, 4);
  assert.equal(mixed.room.remark, null);
  assert.equal(mixed.room.business_unit, null);

  const wizardRoom = byName['向导创建的直播间'];
  assert.deepEqual(wizardRoom.inputs.kinds, ['IN_PUSH']);
  assert.equal(wizardRoom.inputs.push_credentials, 0);
  assert.equal(wizardRoom.outputs.configured_total, 0);

  const workspace = await request(server, `/api/v3/rooms/room:${mixedStreamId}/workspace`);
  assert.equal(workspace.response.status, 200);
  assert.equal(workspace.body.room.business_unit, null);
  assert.equal(workspace.body.room.remark, null);
});
