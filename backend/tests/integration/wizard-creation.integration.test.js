const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const jwt = require('jsonwebtoken');

// PHASE-09 FIX-01..05 integration gate: the creation wizard's multi-POST
// sequence against the REAL routers + database — one-time ingest credentials,
// Idempotency-Key replay for lost external-source responses, the
// pull_task_sources id mapping, all three wizard output scenes with the exact
// payloads the frontend builder produces, run-plan output refs, and the
// preflight BLOCKED answer shape.

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'srs-manager-wizard-api-'));
process.env.DATA_DIR = dataDir;
process.env.JWT_SECRET = 'test-wizard-creation-secret';
process.env.SRS_API_URL = 'http://127.0.0.1:1985/api/v1';

const config = require('../../config');
const db = require('../../database');
const streamsRouter = require('../../routes/streams');
const externalSourcesRouter = require('../../routes/external-sources');
const pullTasksRouter = require('../../routes/pull-tasks');
const v3Router = require('../../routes/v3');
const srsService = require('../../services/srs');

const originals = { getStreams: srsService.getStreams, listClients: srsService.listClients };
srsService.getStreams = async () => [];
srsService.listClients = async () => [];

function startApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/streams', streamsRouter);
  app.use('/api/external-sources', externalSourcesRouter);
  app.use('/api/pull-tasks', pullTasksRouter);
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

test.before(async () => {
  globalThis.server = await startApp();
});

test.after(async () => {
  await new Promise(resolve => globalThis.server.close(resolve));
  srsService.getStreams = originals.getStreams;
  srsService.listClients = originals.listClients;
  db.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('FIX-3: external source creation replays by Idempotency-Key and never leaks the raw URL', async () => {
  const payload = { name: '合作方演播室', source_url: 'rtmp://upstream.example/live/a', protocol: 'rtmp', pull_mode: 'pull' };
  const first = await request(globalThis.server, '/api/external-sources', {
    method: 'POST', body: JSON.stringify(payload), headers: { 'Idempotency-Key': 'wizard-external-source-k1' }
  });
  assert.equal(first.response.status, 201);
  assert.ok(first.body.id);
  assert.equal(first.body.source_url, undefined, 'raw source_url must never be returned');
  assert.ok(first.body.source_url_masked);
  assert.notEqual(first.body.idempotent_replay, true);

  // The exact retry the journal sends when the first response was lost.
  const replay = await request(globalThis.server, '/api/external-sources', {
    method: 'POST', body: JSON.stringify(payload), headers: { 'Idempotency-Key': 'wizard-external-source-k1' }
  });
  assert.equal(replay.response.status, 200, 'replay answers 200, not a second 201');
  assert.equal(replay.body.id, first.body.id);
  assert.equal(replay.body.idempotent_replay, true);

  const rows = db.prepare('SELECT COUNT(*) AS count FROM external_sources WHERE idempotency_key = ?').get('wizard-external-source-k1');
  assert.equal(rows.count, 1, 'one lost response must not fork a duplicate source');

  // A different key is a different creation intent, not a replay.
  const separate = await request(globalThis.server, '/api/external-sources', {
    method: 'POST', body: JSON.stringify(payload), headers: { 'Idempotency-Key': 'wizard-external-source-k2' }
  });
  assert.equal(separate.response.status, 201);
  assert.notEqual(separate.body.id, first.body.id);

  const list = await request(globalThis.server, '/api/external-sources');
  assert.equal(list.response.status, 200);
  const listed = list.body.find(item => item.name === '合作方演播室' && item.source_url_masked);
  assert.ok(listed, 'list still answers with the masked projection');
  // FIX-02-4: idempotency_key is server-side reconcile state — never returned
  // to the browser. The journal replays via its own key + POST, never via GET.
  assert.equal(listed.idempotency_key, undefined, 'list must not leak the idempotency key');
  assert.equal(listed.source_url, undefined);
});

test('FIX-1: ingest credential plaintext exists only in the create response', async () => {
  const created = await request(globalThis.server, '/api/streams', {
    method: 'POST', body: JSON.stringify({ name: '推流凭据间', protocol: 'rtmp' })
  });
  assert.equal(created.response.status, 201);
  const roomId = `room:${created.body.stream.id}`;

  // Partial-update semantics guard at the route boundary: over-long identity
  // fields answer 400 with the frozen code, not a 500.
  const tooLong = await request(globalThis.server, '/api/streams', {
    method: 'POST', body: JSON.stringify({ name: '超长字段间', protocol: 'rtmp', remark: 'x'.repeat(201) })
  });
  assert.equal(tooLong.response.status, 400);
  assert.equal(tooLong.body.code, 'VALIDATION_STREAM_FIELD_TOO_LONG');

  const before = await request(globalThis.server, `/api/v3/rooms/${roomId}/ingest-credentials`);
  assert.deepEqual(before.body.credentials, []);

  // FIX-02-1 contract lock: the backend answers 400 V3_INGEST_VALIDATION for a
  // label-less create — exactly what the old wizard ({}) hit in production.
  const labelless = await request(globalThis.server, `/api/v3/rooms/${roomId}/ingest-credentials`, {
    method: 'POST', body: JSON.stringify({})
  });
  assert.equal(labelless.response.status, 400);
  assert.equal(labelless.body.code, 'V3_INGEST_VALIDATION');

  // The journal's real body: { label: wizardCredentialLabel(room name) } —
  // same rule as frontend/src/lib/wizard-flow.js wizardCredentialLabel.
  const issued = await request(globalThis.server, `/api/v3/rooms/${roomId}/ingest-credentials`, {
    method: 'POST', body: JSON.stringify({ label: `wizard-${created.body.stream.name}` })
  });
  assert.equal(issued.response.status, 201);
  assert.equal(issued.body.credential.label, `wizard-${created.body.stream.name}`);
  assert.ok(issued.body.token, 'plaintext token ships in the create response only');
  assert.ok(issued.body.publish_url.includes('ingest_token='));
  assert.ok(issued.body.credential.token_hint);

  const after = await request(globalThis.server, `/api/v3/rooms/${roomId}/ingest-credentials`);
  assert.equal(after.body.credentials.length, 1);
  assert.equal(after.body.credentials[0].token, undefined, 'list must never re-expose the token');
  assert.equal(after.body.credentials[0].token_hint, issued.body.credential.token_hint);
});

test('FIX-2/FIX-4/FIX-5: IN_PULL chain — distinct ptsrc id, three scenes, run plan refs, BLOCKED preflight', async () => {
  const created = await request(globalThis.server, '/api/streams', {
    method: 'POST', body: JSON.stringify({ name: '任意社会学', protocol: 'rtmp', remark: '晚间场' })
  });
  const streamId = created.body.stream.id;
  const roomId = `room:${streamId}`;

  // Filler room with a TWO-source pull task: the external_sources,
  // pull_tasks and pull_task_sources AUTOINCREMENT counters then advance by
  // different amounts, so the chain under test gets pairwise-distinct ids by
  // construction instead of by coincidence.
  const fillerStream = await request(globalThis.server, '/api/streams', {
    method: 'POST', body: JSON.stringify({ name: '占位间', protocol: 'rtmp' })
  });
  const fillerSourceA = await request(globalThis.server, '/api/external-sources', {
    method: 'POST', body: JSON.stringify({ name: '占位源A', source_url: 'rtmp://placeholder.invalid/live/a', protocol: 'rtmp' })
  });
  const fillerSourceB = await request(globalThis.server, '/api/external-sources', {
    method: 'POST', body: JSON.stringify({ name: '占位源B', source_url: 'rtmp://placeholder.invalid/live/b', protocol: 'rtmp' })
  });
  const fillerTask = await request(globalThis.server, '/api/pull-tasks', {
    method: 'POST',
    body: JSON.stringify({ stream_id: fillerStream.body.stream.id, external_source_id: fillerSourceA.body.id })
  });
  const fillerSecondSource = await request(globalThis.server, `/api/pull-tasks/${fillerTask.body.id}/sources`, {
    method: 'POST', body: JSON.stringify({ external_source_id: fillerSourceB.body.id, priority: 2 })
  });
  assert.equal(fillerSecondSource.response.status, 201);

  // External source with an idempotency key, as the journal sends it.
  const source = await request(globalThis.server, '/api/external-sources', {
    method: 'POST',
    body: JSON.stringify({ name: '合作方演播室', source_url: 'rtmp://upstream.example/live/a', protocol: 'rtmp', pull_mode: 'pull' }),
    headers: { 'Idempotency-Key': 'wizard-external-source-chain' }
  });
  assert.equal(source.response.status, 201);
  const externalSourceId = source.body.id;

  const task = await request(globalThis.server, '/api/pull-tasks', {
    method: 'POST', body: JSON.stringify({ stream_id: streamId, external_source_id: externalSourceId })
  });
  assert.equal(task.response.status, 201);
  const pullTaskId = task.body.id;
  const pullTaskSourceId = task.body.sources[0].id;
  // The frozen fixture rule: all three ids differ, so a wrong mapping cannot
  // accidentally pass.
  assert.notEqual(pullTaskSourceId, externalSourceId);
  assert.notEqual(pullTaskId, externalSourceId);
  assert.notEqual(pullTaskId, pullTaskSourceId);
  assert.equal(Number(task.body.sources[0].external_source_id), Number(externalSourceId));

  // The workspace source id embeds pull_task_sources.id and the compatibility
  // block carries the precise mapping anchors.
  const workspace = await request(globalThis.server, `/api/v3/rooms/${roomId}/workspace`);
  assert.equal(workspace.response.status, 200);
  const resolved = workspace.body.sources.find(item =>
    item.kind === 'IN_PULL' && Number(item.compatibility.external_source_id) === Number(externalSourceId));
  assert.ok(resolved, 'workspace must expose the IN_PULL source via compatibility');
  assert.equal(resolved.id, `source:in_pull:ptsrc-${pullTaskSourceId}`);

  // The three wizard scenes with the EXACT payloads buildWizardOutputIntents
  // produces from GET /v3/output/scenes.
  const scenesResponse = await request(globalThis.server, '/api/v3/output/scenes');
  const partnerPullScene = scenesResponse.body.scenes.find(scene => scene.id === 'PARTNER_PULL');
  assert.deepEqual(partnerPullScene.transports, ['rtmp', 'http-flv'], 'PARTNER_PULL scene contract');

  const record = await request(globalThis.server, `/api/v3/rooms/${roomId}/outputs`, {
    method: 'POST',
    body: JSON.stringify({
      mode: 'RECORD', name: '本地输出 1', scene: 'LOCAL_RECORD', format: 'mp4', protection: 'storage-policy',
      processing: { mode: 'PASSTHROUGH' },
      storage: { subdir: '', filename_prefix: '本地输出 1', segment_seconds: 6 }
    })
  });
  assert.equal(record.response.status, 201);
  assert.ok(record.body.output.task.id, 'RECORD creation answers {task, rendition}');
  const recordOutputId = `output:record:${record.body.output.task.id}`;

  const push = await request(globalThis.server, `/api/v3/rooms/${roomId}/outputs`, {
    method: 'POST',
    body: JSON.stringify({
      mode: 'PUSH', name: '我们推给第三方 2', scene: 'LIVE_PLATFORM_PUSH', transport: 'rtmp', protection: 'none',
      processing: { mode: 'PASSTHROUGH' },
      destination: { kind: 'CUSTOM', label: '我们推给第三方 2', target_url: 'rtmp://cdn.example/live/key' }
    })
  });
  assert.equal(push.response.status, 201);
  const pushOutputId = `output:push:${push.body.output.task.id}`;

  const serve = await request(globalThis.server, `/api/v3/rooms/${roomId}/outputs`, {
    method: 'POST',
    body: JSON.stringify({
      mode: 'SERVE', name: '第三方拉我们的输出 3', scene: 'PARTNER_PULL',
      transports: ['rtmp', 'http-flv'], consumer: { label: '第三方拉我们的输出 3' }
    })
  });
  assert.equal(serve.response.status, 201);
  assert.equal(serve.body.output.id, `output:serve:${streamId}`);
  assert.deepEqual(serve.body.output.transports, ['rtmp', 'http-flv']);
  assert.deepEqual(serve.body.output.endpoint_protections, { rtmp: 'access-grant', 'http-flv': 'access-grant' });
  assert.equal(serve.body.output.policy.require_grant, true);
  assert.equal(serve.body.output.policy.endpoint_enabled, false, 'configured but not enabled until start');

  // Run plan referencing all three outputs and the ptsrc program source.
  const plan = await request(globalThis.server, `/api/v3/rooms/${roomId}/run-plans`, {
    method: 'POST',
    body: JSON.stringify({
      name: '任意社会学',
      program_source_id: `source:in_pull:ptsrc-${pullTaskSourceId}`,
      outputs: [
        { output_ref: pushOutputId, importance: 'REQUIRED', auto_start: true, sort_order: 10 },
        { output_ref: serve.body.output.id, importance: 'REQUIRED', auto_start: true, sort_order: 20 },
        { output_ref: recordOutputId, importance: 'REQUIRED', auto_start: true, sort_order: 30 }
      ]
    })
  });
  assert.equal(plan.response.status, 201, plan.body.message);

  const session = await request(globalThis.server, `/api/v3/rooms/${roomId}/sessions`, {
    method: 'POST', body: JSON.stringify({ run_plan_id: plan.body.run_plan.id, title: '任意社会学' })
  });
  assert.equal(session.response.status, 201);
  assert.equal(session.body.session.lifecycle_state, 'PREP');

  // Preflight with nothing running answers 409 + the full BLOCKED evaluation —
  // the shape the journal reads to surface the concrete failure.
  const preflight = await request(globalThis.server, `/api/v3/sessions/${session.body.session.id}/preflight`, {
    method: 'POST', body: JSON.stringify({ mark_ready: true })
  });
  assert.equal(preflight.response.status, 409);
  assert.equal(preflight.body.status, 'BLOCKED');
  assert.ok(preflight.body.summary);
  assert.ok(Array.isArray(preflight.body.checks));
});
