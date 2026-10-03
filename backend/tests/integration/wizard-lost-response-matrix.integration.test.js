const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const express = require('express');
const jwt = require('jsonwebtoken');

// PHASE-09-FIX-03/FIX-04 lost-response failure matrix: every creation-chain
// step is simulated as "the server committed the POST but the client never
// received the response", against the REAL routers, the REAL database and the
// REAL frontend journal (dynamically imported). The acceptance is uniform:
//   - no duplicate resources (asserted by direct SQL counts);
//   - retry never replays finished steps (asserted on recorded api calls);
//   - what can be reconciled is reconciled automatically — outputs via the
//     journal's stable Idempotency-Key (FIX-04: the server replays the exact
//     first creation; the workspace listing is never consulted);
//   - what cannot be reconciled safely STOPS with its own step name instead
//     of adopting a similar resource;
//   - final journal step states and final resource counts are exact.
// Any creation step added to the journal later must join this matrix.

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'srs-manager-wizard-matrix-'));
process.env.DATA_DIR = dataDir;
process.env.JWT_SECRET = 'test-wizard-matrix-secret';
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

async function request(pathname, init = {}) {
  const { port } = globalThis.server.address();
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
  return { status: response.status, body };
}

// The journal speaks client paths (/streams, /v3/...); the server mounts
// everything under /api. Non-2xx answers are thrown with the status and body
// attached — the exact error contract the journal reads (409 preflight body,
// 409 session conflict).
async function send(method, clientPath, payload, options = {}) {
  const { status, body } = await request(`/api${clientPath}`, {
    method,
    body: method === 'POST' ? JSON.stringify(payload ?? {}) : undefined,
    headers: options.headers
  });
  if (status >= 400) {
    const error = new Error(`Request failed with status code ${status}`);
    error.status = status;
    error.body = body;
    throw error;
  }
  return body;
}

// api adapter for the journal with failure injection. Two modes:
//   - 'drop-response' (default): the request REALLY executes (the resource
//     commits) and the response is then dropped — "server succeeded, client
//     never heard back";
//   - 'request-lost': the request never reaches the server — for negative
//     rows where only a PRE-EXISTING similar resource exists to (wrongly)
//     adopt.
function makeApi(losses = []) {
  const state = losses.map(loss => ({ mode: 'drop-response', ...loss, remaining: loss.times ?? 1 }));
  const matches = loss => loss.path ? clientPath => clientPath === loss.path : loss.match;
  const fire = (clientPath, payload, options) => request(`/api${clientPath}`, {
    method: 'POST',
    body: JSON.stringify(payload ?? {}),
    headers: options?.headers
  });
  return {
    calls: [],
    async post(clientPath, payload, options) {
      this.calls.push({ method: 'POST', path: clientPath, key: options?.headers?.['Idempotency-Key'] ?? null });
      const loss = state.find(entry => entry.method !== 'GET' && entry.remaining > 0 && matches(entry)(clientPath));
      if (loss) {
        loss.remaining -= 1;
        if (loss.mode === 'request-lost') throw new Error('network error: request never reached the server');
        await fire(clientPath, payload, options); // server commits…
        throw new Error('network lost after the server accepted the POST'); // …response never arrived
      }
      return send('POST', clientPath, payload, options);
    },
    async get(clientPath) {
      this.calls.push({ method: 'GET', path: clientPath });
      const loss = state.find(entry => entry.method === 'GET' && entry.remaining > 0 && matches(entry)(clientPath));
      if (loss) {
        loss.remaining -= 1;
        throw new Error('network lost');
      }
      return send('GET', clientPath);
    }
  };
}

const count = (sql, ...args) => db.prepare(sql).get(...args).count;
const one = (sql, ...args) => {
  const row = db.prepare(sql).get(...args);
  return row ? Object.values(row)[0] : undefined;
};

// Wizard intents use the exact payload grammar buildWizardOutputIntents
// produces from GET /v3/output/scenes (see wizard-creation.integration.test.js).
function pushOutputIntent(name, targetUrl = 'rtmp://cdn.example/live/key') {
  return {
    name: `${name}-推`, mode: 'PUSH', scene: 'LIVE_PLATFORM_PUSH',
    payload: {
      mode: 'PUSH', name: `${name}-推`, scene: 'LIVE_PLATFORM_PUSH', transport: 'rtmp', protection: 'none',
      processing: { mode: 'PASSTHROUGH' },
      destination: { kind: 'CUSTOM', label: `${name}-推`, target_url: targetUrl }
    }
  };
}

function recordOutputIntent(name, { format = 'mp4', subdir = '', filenamePrefix = null } = {}) {
  return {
    name: `${name}-录`, mode: 'RECORD', scene: 'LOCAL_RECORD',
    payload: {
      mode: 'RECORD', name: `${name}-录`, scene: 'LOCAL_RECORD', format, protection: 'storage-policy',
      processing: { mode: 'PASSTHROUGH' },
      storage: { subdir, filename_prefix: filenamePrefix ?? `${name}-录`, segment_seconds: 6 }
    }
  };
}

function serveOutputIntent(name) {
  // PARTNER_PULL grammar from buildOutputPayload: scene transports + consumer label.
  return {
    name: `${name}-播`, mode: 'SERVE', scene: 'PARTNER_PULL',
    payload: {
      mode: 'SERVE', name: `${name}-播`, scene: 'PARTNER_PULL',
      transports: ['rtmp', 'http-flv'], consumer: { label: `${name}-播` }
    }
  };
}

function pullIntent(name, { outputs = true, createRunPlan = true } = {}) {
  const outputList = outputs === true
    ? [pushOutputIntent(name), recordOutputIntent(name)]
    : (Array.isArray(outputs) ? outputs : []);
  return {
    name,
    protocol: 'rtmp',
    remark: null,
    businessUnit: null,
    inputDirection: 'IN_PULL',
    pullSource: { name: `源-${name}`, source_url: 'rtmp://upstream.example/live/a', protocol: 'rtmp' },
    outputs: outputList,
    createRunPlan,
    planName: name,
    credentialLabel: null
  };
}

function pushIntent(name) {
  return {
    name,
    protocol: 'rtmp',
    remark: null,
    businessUnit: null,
    inputDirection: 'IN_PUSH',
    pullSource: null,
    credentialLabel: `wizard-${name}`,
    outputs: [],
    createRunPlan: false,
    planName: null
  };
}

// Every chain that reaches preflight on a fresh room ends BLOCKED (nothing is
// running) — the documented terminal state for the matrix's "run completed"
// rows: all eight steps journaled, preflight recorded, nothing duplicated.
async function runJournal(intent, api, seed = {}) {
  const journal = { ...globalThis.wizard.newJournal(), ...seed };
  return globalThis.wizard.runRoomCreation({ journal, intent, api });
}

const endsBlocked = async (promise) => {
  const result = await promise.catch(error => error);
  assert.ok(result instanceof globalThis.wizard.CreationInterrupted, `expected CreationInterrupted, got ${result}`);
  assert.equal(result.step, 'preflight');
  assert.equal(result.journal.preflight.status, 'BLOCKED');
  return result;
};

test.before(async () => {
  globalThis.server = await startApp();
  globalThis.wizard = await import(pathToFileURL(path.join(__dirname, '..', '..', '..', 'frontend', 'src', 'lib', 'create-room-journal.js')).href);
});

test.after(async () => {
  await new Promise(resolve => globalThis.server.close(resolve));
  srsService.getStreams = originals.getStreams;
  srsService.listClients = originals.listClients;
  db.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('matrix: stream — lost POST reconciles by unique name, one stream only', async () => {
  const intent = pullIntent('矩阵-流');
  const api = makeApi([{ match: p => p === '/streams' }]);
  const result = await endsBlocked(runJournal(intent, api));
  assert.equal(count('SELECT COUNT(*) AS count FROM streams WHERE name = ?', intent.name), 1);
  assert.equal(result.journal.stream_id, one('SELECT id FROM streams WHERE name = ?', intent.name));
  assert.equal(result.journal.steps.stream.status, 'done');
  assert.equal(api.calls.filter(call => call.method === 'POST' && call.path === '/streams').length, 1);
});

test('matrix: ingest credential — lost POST adopts the ACTIVE credential, token never re-exposed', async () => {
  const intent = pushIntent('矩阵-凭据');
  const api = makeApi([{ match: p => p.endsWith('/ingest-credentials') }]);
  const journal = await runJournal(intent, api);
  assert.equal(journal.steps.credential.status, 'done');
  assert.equal(journal.credential_recovered, true);
  assert.equal(journal.credential_display, null, 'recovery must not re-expose the plaintext token');
  assert.equal(count('SELECT COUNT(*) AS count FROM ingest_credentials WHERE stream_id = ?', journal.stream_id), 1);
  assert.equal(api.calls.filter(call => call.method === 'POST' && call.path.endsWith('/ingest-credentials')).length, 1);
});

test('matrix: external source — lost POST interrupts, retry replays the SAME key, exactly one row', async () => {
  const intent = pullIntent('矩阵-源');
  const firstApi = makeApi([{ match: p => p === '/external-sources' }]);
  const first = await runJournal(intent, firstApi).catch(error => error);
  assert.ok(first instanceof globalThis.wizard.CreationInterrupted);
  assert.equal(first.step, 'source');
  const key = first.journal.source_idempotency_key;
  assert.match(key, /^wizard-external-source-/);
  assert.equal(first.journal.source_id, null);

  const retryApi = makeApi();
  // Resume the SAME journal (stream already recorded) — the retry only replays
  // the unfinished tail, exactly like the wizard's in-app retry.
  const result = await endsBlocked(globalThis.wizard.runRoomCreation({ journal: first.journal, intent, api: retryApi }));
  assert.equal(result.journal.source_idempotency_key, key, 'the journal replays its own key');
  assert.equal(count('SELECT COUNT(*) AS count FROM external_sources WHERE idempotency_key = ?', key), 1);
  const retryPosts = retryApi.calls.filter(call => call.method === 'POST').map(call => call.path);
  assert.equal(retryPosts[0], '/external-sources');
  assert.ok(!retryPosts.includes('/streams'), 'retry must not replay the finished stream step');
});

test('matrix: pull task — lost POST adopts the existing task for this room', async () => {
  const intent = pullIntent('矩阵-拉流');
  const api = makeApi([{ match: p => p === '/pull-tasks' }]);
  const result = await endsBlocked(runJournal(intent, api));
  assert.equal(count('SELECT COUNT(*) AS count FROM pull_tasks WHERE stream_id = ?', result.journal.stream_id), 1);
  assert.equal(result.journal.pull_task_id, one('SELECT id FROM pull_tasks WHERE stream_id = ?', result.journal.stream_id));
  assert.equal(result.journal.steps['pull-task'].status, 'done');
  assert.ok(result.journal.pull_task_source_id, 'ptsrc link captured from the adopted task');
});

test('matrix: output PUSH — lost POST, retry replays the SAME key: one forward task, same output id', async () => {
  const intent = pullIntent('矩阵-输出');
  const firstApi = makeApi([{ match: p => p.startsWith('/v3/rooms/') && p.endsWith('/outputs') }]);
  const first = await runJournal(intent, firstApi).catch(error => error);
  assert.ok(first instanceof globalThis.wizard.CreationInterrupted);
  assert.equal(first.step, 'output:0');
  const key = first.journal.output_idempotency_keys[0];
  assert.match(key, /^wizard-output-0-/);
  // The server committed the PUSH before the response was dropped.
  assert.equal(count('SELECT COUNT(*) AS count FROM forward_tasks WHERE stream_id = ?', first.journal.stream_id), 1);
  const committedId = one('SELECT id FROM forward_tasks WHERE stream_id = ?', first.journal.stream_id);
  assert.equal(count('SELECT COUNT(*) AS count FROM record_tasks WHERE stream_id = ?', first.journal.stream_id), 0);

  const retryApi = makeApi();
  const result = await endsBlocked(globalThis.wizard.runRoomCreation({ journal: first.journal, intent, api: retryApi }));
  assert.equal(count('SELECT COUNT(*) AS count FROM forward_tasks WHERE stream_id = ?', result.journal.stream_id), 1, 'no duplicate forward task');
  assert.equal(result.journal.output_ids[0], `output:push:${committedId}`, 'the replay returns the FIRST creation');
  const replayCall = retryApi.calls.find(call => call.method === 'POST' && call.path.endsWith('/outputs'));
  assert.equal(replayCall.key, key, 'the retry replays the journal\'s own key');
});

test('matrix: output RECORD — lost POST, retry replays the same key: one record task', async () => {
  const intent = pullIntent('矩阵-录像', { outputs: true, createRunPlan: true });
  const firstApi = makeApi([{ match: p => p.startsWith('/v3/rooms/') && p.endsWith('/outputs') }]);
  const first = await runJournal(intent, firstApi).catch(error => error);
  assert.ok(first instanceof globalThis.wizard.CreationInterrupted);
  assert.equal(first.step, 'output:0');
  assert.equal(count('SELECT COUNT(*) AS count FROM forward_tasks WHERE stream_id = ?', first.journal.stream_id), 1);
  const key = first.journal.output_idempotency_keys[0];

  const retryApi = makeApi();
  const result = await endsBlocked(globalThis.wizard.runRoomCreation({ journal: first.journal, intent, api: retryApi }));
  assert.equal(count('SELECT COUNT(*) AS count FROM record_tasks WHERE stream_id = ?', result.journal.stream_id), 1, 'no duplicate record task');
  assert.equal(result.journal.steps['output:1'].status, 'done');
  const replayCall = retryApi.calls.find(call => call.method === 'POST' && call.path.endsWith('/outputs'));
  assert.equal(replayCall.key, key);
});

test('matrix: output SERVE — repeated key replays the configuration without anomalous state', async () => {
  const intent = pullIntent('矩阵-分发', { outputs: [serveOutputIntent('矩阵-分发')], createRunPlan: true });
  const firstApi = makeApi([{ match: p => p.startsWith('/v3/rooms/') && p.endsWith('/outputs') }]);
  const first = await runJournal(intent, firstApi).catch(error => error);
  assert.ok(first instanceof globalThis.wizard.CreationInterrupted);
  assert.equal(first.step, 'output:0');
  // The SERVE policy committed before the response was dropped.
  const streamId = first.journal.stream_id;
  assert.equal(count('SELECT COUNT(*) AS count FROM out_pull_policies WHERE stream_id = ?', streamId), 1);
  const key = first.journal.output_idempotency_keys[0];

  const retryApi = makeApi();
  const outcome = await globalThis.wizard.runRoomCreation({ journal: first.journal, intent, api: retryApi }).catch(error => error);
  // A SERVE-only room has no runnable output task, so preflight need not end
  // BLOCKED here — what matters is the replay contract below.
  const journal = outcome instanceof globalThis.wizard.CreationInterrupted ? outcome.journal : outcome;
  assert.equal(journal.steps['output:0'].status, 'done');
  assert.equal(journal.output_ids[0], `output:serve:${streamId}`);
  const replayCall = retryApi.calls.find(call => call.method === 'POST' && call.path.endsWith('/outputs'));
  assert.equal(replayCall.key, key);
  // One converged policy row — the replay re-applies the same configuration
  // and never produces a duplicated or half-written state.
  const policies = db.prepare('SELECT endpoint_enabled, v3_metadata_json FROM out_pull_policies WHERE stream_id = ?').all(streamId);
  assert.equal(policies.length, 1);
  const metadata = JSON.parse(policies[0].v3_metadata_json);
  assert.equal(metadata.scene, 'PARTNER_PULL');
  assert.deepEqual(metadata.advertised_transports, ['rtmp', 'http-flv']);
  assert.equal(metadata.endpoint_protections.rtmp, 'access-grant');
  assert.equal(metadata.endpoint_protections['http-flv'], 'access-grant');
});

test('matrix: run plan — lost POST adopts the fingerprint-identical plan, exactly one plan', async () => {
  const intent = pullIntent('矩阵-方案');
  const api = makeApi([{ match: p => p.endsWith('/run-plans') }]);
  const result = await endsBlocked(runJournal(intent, api));
  assert.equal(count('SELECT COUNT(*) AS count FROM run_plans WHERE stream_id = ?', result.journal.stream_id), 1);
  assert.equal(result.journal.steps['run-plan'].status, 'done');
  assert.equal(api.calls.filter(call => call.method === 'POST' && call.path.endsWith('/run-plans')).length, 1);
});

test('matrix: session — lost POST adopts the exact PREP session and continues to preflight', async () => {
  const intent = pullIntent('矩阵-会话');
  const api = makeApi([{ match: p => p.endsWith('/sessions') && p.startsWith('/v3/rooms/') }]);
  const result = await endsBlocked(runJournal(intent, api));
  assert.equal(count('SELECT COUNT(*) AS count FROM sessions WHERE stream_id = ?', result.journal.stream_id), 1);
  assert.equal(result.journal.steps.session.status, 'done');
  assert.equal(api.calls.filter(call => call.method === 'POST' && call.path.endsWith('/sessions')).length, 1);
});

test('matrix: session deadlock — response AND recovery GET lost, retry answers 409, reconcile unblocks (1 session)', async () => {
  const intent = pullIntent('矩阵-会话死锁');
  const firstApi = makeApi([
    { match: p => p.endsWith('/sessions') && p.startsWith('/v3/rooms/') },
    { method: 'GET', match: p => p.endsWith('/sessions') && p.startsWith('/v3/rooms/') }
  ]);
  const first = await runJournal(intent, firstApi).catch(error => error);
  assert.ok(first instanceof globalThis.wizard.CreationInterrupted);
  assert.equal(first.step, 'session');
  assert.equal(first.journal.session_id, null);
  assert.equal(String(first.journal.run_plan_id), String(one('SELECT id FROM run_plans WHERE stream_id = ?', first.journal.stream_id)));

  // The retry's POST now meets the server's REAL 409 (active session exists) —
  // the exact spot the journal used to be stuck at forever.
  const retryApi = makeApi();
  const result = await endsBlocked(
    globalThis.wizard.runRoomCreation({ journal: first.journal, intent, api: retryApi }).catch(async error => {
      const interrupted = error;
      assert.equal(interrupted.step, 'preflight');
      return interrupted;
    })
  );
  assert.equal(result.journal.session_id, one('SELECT id FROM sessions WHERE stream_id = ?', result.journal.stream_id));
  assert.equal(count('SELECT COUNT(*) AS count FROM sessions WHERE stream_id = ?', result.journal.stream_id), 1);
  const retryPosts = retryApi.calls.filter(call => call.method === 'POST').map(call => call.path);
  assert.deepEqual(retryPosts.filter(p => p !== '/v3/sessions/' + result.journal.session_id + '/preflight'),
    [`/v3/rooms/room:${result.journal.stream_id}/sessions`],
    'retry only re-attempts session then preflight — nothing upstream is replayed');
});

test('matrix: preflight — lost POST re-evaluates alone, no resource re-created', async () => {
  const intent = pullIntent('矩阵-预检');
  const firstApi = makeApi([{ match: p => p.includes('/preflight') }]);
  const first = await runJournal(intent, firstApi).catch(error => error);
  assert.ok(first instanceof globalThis.wizard.CreationInterrupted);
  assert.equal(first.step, 'preflight');
  assert.equal(first.journal.preflight, null, 'a lost response must not fabricate a status');
  const streamId = first.journal.stream_id;
  const before = {
    streams: count('SELECT COUNT(*) AS count FROM streams WHERE id = ?', streamId),
    sources: count('SELECT COUNT(*) AS count FROM external_sources WHERE id = ?', first.journal.source_id),
    tasks: count('SELECT COUNT(*) AS count FROM pull_tasks WHERE stream_id = ?', streamId),
    plans: count('SELECT COUNT(*) AS count FROM run_plans WHERE stream_id = ?', streamId),
    sessions: count('SELECT COUNT(*) AS count FROM sessions WHERE stream_id = ?', streamId)
  };

  const retryApi = makeApi();
  const result = await endsBlocked(globalThis.wizard.runRoomCreation({ journal: first.journal, intent, api: retryApi }));
  assert.deepEqual(retryApi.calls.filter(call => call.method === 'POST').map(call => call.path),
    [`/v3/sessions/${result.journal.session_id}/preflight`],
    'retry re-runs preflight ONLY — safe re-evaluation');
  assert.equal(count('SELECT COUNT(*) AS count FROM streams WHERE id = ?', streamId), before.streams);
  assert.equal(count('SELECT COUNT(*) AS count FROM external_sources WHERE id = ?', first.journal.source_id), before.sources);
  assert.equal(count('SELECT COUNT(*) AS count FROM pull_tasks WHERE stream_id = ?', streamId), before.tasks);
  assert.equal(count('SELECT COUNT(*) AS count FROM run_plans WHERE stream_id = ?', streamId), before.plans);
  assert.equal(count('SELECT COUNT(*) AS count FROM sessions WHERE stream_id = ?', streamId), before.sessions);
});

test('matrix negative: a same-name run plan with different outputs is NEVER adopted', async () => {
  // Pre-seed the room's chain by hand, then a zero-output plan carrying the
  // SAME name and the SAME program source — only the outputs dimension
  // differs from what the journal is about to attempt. The journal resumes
  // with stream_id already recorded (an earlier run created the room), and
  // its run-plan POST never reaches the server (request-lost), so the ONLY
  // adoptable candidate is the pre-seeded similar plan.
  const seeded = await send('POST', '/streams', { name: '矩阵-方案负向', protocol: 'rtmp' });
  const streamId = seeded.stream.id;
  const source = await send('POST', '/external-sources', {
    name: '源-矩阵-方案负向', source_url: 'rtmp://upstream.example/live/a', protocol: 'rtmp', pull_mode: 'pull'
  }, { headers: { 'Idempotency-Key': 'matrix-negative-plan-seed' } });
  const task = await send('POST', '/pull-tasks', { stream_id: streamId, external_source_id: source.id });
  await send('POST', `/v3/rooms/room:${streamId}/run-plans`, {
    name: '矩阵-方案负向',
    program_source_id: `source:in_pull:ptsrc-${task.sources[0].id}`,
    outputs: []
  });

  const intent = pullIntent('矩阵-方案负向');
  const api = makeApi([{ mode: 'request-lost', match: p => p.endsWith('/run-plans') }]);
  const result = await runJournal(intent, api, { stream_id: streamId }).catch(error => error);
  assert.ok(result instanceof globalThis.wizard.CreationInterrupted);
  assert.equal(result.step, 'run-plan', 'similar-but-different plan must stop the journal, not be adopted');
  assert.equal(result.journal.run_plan_id, null);
  assert.equal(count('SELECT COUNT(*) AS count FROM run_plans WHERE stream_id = ?', streamId), 1, 'no second plan created');
});

test('matrix negative: a foreign active session is a real conflict, never adopted', async () => {
  const seeded = await send('POST', '/streams', { name: '矩阵-会话负向', protocol: 'rtmp' });
  const streamId = seeded.stream.id;
  const plan = await send('POST', `/v3/rooms/room:${streamId}/run-plans`, { name: '预置方案', outputs: [] });
  await send('POST', `/v3/rooms/room:${streamId}/sessions`, { run_plan_id: plan.run_plan.id, title: '别人的会话' });

  const intent = pullIntent('矩阵-会话负向');
  const api = makeApi();
  const result = await runJournal(intent, api, { stream_id: streamId }).catch(error => error);
  assert.ok(result instanceof globalThis.wizard.CreationInterrupted);
  assert.equal(result.step, 'session');
  assert.equal(result.journal.session_id, null);
  assert.ok(result.journal.run_plan_id, 'the journal created its own plan before hitting the conflict');
  assert.notEqual(String(result.journal.run_plan_id), String(plan.run_plan.id));
  assert.equal(count('SELECT COUNT(*) AS count FROM sessions WHERE stream_id = ?', streamId), 1, 'the foreign session is untouched');
});

test('matrix negative A: same-name same-scene PUSH with a different target_url is NEVER adopted', async () => {
  // The room already carries an old output that a weak name+mode+scene
  // fingerprint WOULD have matched. The journal's own POST never reaches the
  // server (request-lost), so the only adoptable candidate is the old one —
  // which is exactly what must NOT happen (FIX-04 removed that path).
  const seeded = await send('POST', '/streams', { name: '矩阵-输出负向A', protocol: 'rtmp' });
  const streamId = seeded.stream.id;
  await send('POST', `/v3/rooms/room:${streamId}/outputs`, {
    mode: 'PUSH', name: '矩阵-输出负向A-推', scene: 'LIVE_PLATFORM_PUSH', transport: 'rtmp', protection: 'none',
    processing: { mode: 'PASSTHROUGH' },
    destination: { kind: 'CUSTOM', label: '矩阵-输出负向A-推', target_url: 'rtmp://old.example/live/old' }
  });

  const intent = pullIntent('矩阵-输出负向A', { outputs: [pushOutputIntent('矩阵-输出负向A', 'rtmp://new.example/live/new')], createRunPlan: false });
  const api = makeApi([{ mode: 'request-lost', match: p => p.startsWith('/v3/rooms/') && p.endsWith('/outputs') }]);
  const result = await runJournal(intent, api, { stream_id: streamId }).catch(error => error);
  assert.ok(result instanceof globalThis.wizard.CreationInterrupted);
  assert.equal(result.step, 'output:0', 'a similar old output must stop the journal, not be adopted');
  assert.equal(result.journal.output_ids[0], undefined);
  assert.equal(count('SELECT COUNT(*) AS count FROM forward_tasks WHERE stream_id = ?', streamId), 1, 'no second task created');
  assert.equal(one('SELECT target_url FROM forward_tasks WHERE stream_id = ?', streamId), 'rtmp://old.example/live/old', 'the old output is untouched');
});

test('matrix negative B: same-name LOCAL_RECORD with a different format/subdir is NEVER mis-adopted', async () => {
  const seeded = await send('POST', '/streams', { name: '矩阵-输出负向B', protocol: 'rtmp' });
  const streamId = seeded.stream.id;
  await send('POST', `/v3/rooms/room:${streamId}/outputs`, {
    mode: 'RECORD', name: '矩阵-输出负向B-录', scene: 'LOCAL_RECORD', format: 'ts', protection: 'storage-policy',
    processing: { mode: 'PASSTHROUGH' },
    storage: { subdir: 'legacy', filename_prefix: '矩阵-输出负向B-录', segment_seconds: 6 }
  });

  const intent = pullIntent('矩阵-输出负向B', { outputs: [recordOutputIntent('矩阵-输出负向B', { format: 'mp4', subdir: '' })], createRunPlan: false });
  const api = makeApi([{ mode: 'request-lost', match: p => p.startsWith('/v3/rooms/') && p.endsWith('/outputs') }]);
  const result = await runJournal(intent, api, { stream_id: streamId }).catch(error => error);
  assert.ok(result instanceof globalThis.wizard.CreationInterrupted);
  assert.equal(result.step, 'output:0');
  assert.equal(result.journal.output_ids[0], undefined);
  assert.equal(count('SELECT COUNT(*) AS count FROM record_tasks WHERE stream_id = ?', streamId), 1, 'no second record task');
  const old = db.prepare('SELECT format, subdir FROM record_tasks WHERE stream_id = ?').get(streamId);
  assert.equal(old.format, 'ts');
  assert.equal(old.subdir, 'legacy');
});

test('matrix negative C: the same Idempotency-Key with a changed payload → 409, the original stays untouched', async () => {
  const seeded = await send('POST', '/streams', { name: '矩阵-幂等负向C', protocol: 'rtmp' });
  const streamId = seeded.stream.id;
  const payload = {
    mode: 'PUSH', name: '矩阵-幂等负向C-推', scene: 'LIVE_PLATFORM_PUSH', transport: 'rtmp', protection: 'none',
    processing: { mode: 'PASSTHROUGH' },
    destination: { kind: 'CUSTOM', label: '矩阵-幂等负向C-推', target_url: 'rtmp://original.example/live/keep' }
  };
  const first = await request(`/api/v3/rooms/room:${streamId}/outputs`, {
    method: 'POST', body: JSON.stringify(payload), headers: { 'Idempotency-Key': 'matrix-negative-key-c' }
  });
  assert.equal(first.status, 201);

  const changed = JSON.parse(JSON.stringify(payload));
  changed.destination.target_url = 'rtmp://hijack.example/live/other';
  const conflict = await request(`/api/v3/rooms/room:${streamId}/outputs`, {
    method: 'POST', body: JSON.stringify(changed), headers: { 'Idempotency-Key': 'matrix-negative-key-c' }
  });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.code, 'V3_OUTPUT_IDEMPOTENCY_CONFLICT');
  assert.equal(count('SELECT COUNT(*) AS count FROM forward_tasks WHERE stream_id = ?', streamId), 1, 'no resource created for the conflicting request');
  assert.equal(one('SELECT target_url FROM forward_tasks WHERE stream_id = ?', streamId), 'rtmp://original.example/live/keep');
});

test('matrix negative D: lost response AND lost workspace GET — retry recovers by key alone, no workspace unlock required', async () => {
  const intent = pullIntent('矩阵-输出负向D', { outputs: [pushOutputIntent('矩阵-输出负向D')], createRunPlan: false });
  const lostEverything = () => makeApi([
    { match: p => p.startsWith('/v3/rooms/') && p.endsWith('/outputs') },
    { method: 'GET', match: p => p.endsWith('/workspace'), times: 99 }
  ]);
  const first = await runJournal(intent, lostEverything()).catch(error => error);
  assert.ok(first instanceof globalThis.wizard.CreationInterrupted);
  assert.equal(first.step, 'output:0');
  const key = first.journal.output_idempotency_keys[0];
  const committedId = one('SELECT id FROM forward_tasks WHERE stream_id = ?', first.journal.stream_id);

  // Every workspace GET stays lost — the retry must still recover purely via
  // the Idempotency-Key replay (the POST itself is NOT lost this time).
  const retryApi = makeApi([{ method: 'GET', match: p => p.endsWith('/workspace'), times: 99 }]);
  const journal = await globalThis.wizard.runRoomCreation({ journal: first.journal, intent, api: retryApi });
  assert.equal(journal.output_ids[0], `output:push:${committedId}`);
  assert.equal(count('SELECT COUNT(*) AS count FROM forward_tasks WHERE stream_id = ?', journal.stream_id), 1);
  const replayCall = retryApi.calls.find(call => call.method === 'POST' && call.path.endsWith('/outputs'));
  assert.equal(replayCall.key, key);
  assert.ok(!retryApi.calls.some(call => call.method === 'GET' && call.path.endsWith('/workspace')),
    'output recovery never reads the workspace');
});

test('matrix: abandon → the new transaction uses brand-new output keys, never the abandoned journal\'s', async () => {
  const intent = pullIntent('矩阵-放弃');
  const firstApi = makeApi([{ match: p => p.startsWith('/v3/rooms/') && p.endsWith('/outputs') }]);
  const first = await runJournal(intent, firstApi).catch(error => error);
  assert.ok(first instanceof globalThis.wizard.CreationInterrupted);
  assert.equal(first.step, 'output:0');
  const abandonedKeys = first.journal.output_idempotency_keys.filter(Boolean);
  assert.equal(abandonedKeys.length, 1);
  const abandonedRoom = first.journal.stream_id;

  // The operator deletes the leftover PUSH output as the abandon notice
  // instructs (nothing is auto-deleted). Under the frozen idempotency state
  // machine the abandoned key is now a RESULT_GONE tombstone — so the new
  // transaction MUST NOT inherit it, or its output step would die on the
  // tombstone. The abandon path in wizard-ui-state starts from a fresh
  // newJournal(); the user renames the room (the point of abandoning) and
  // resubmits.
  db.prepare('DELETE FROM forward_tasks WHERE stream_id = ?').run(abandonedRoom);

  const renamed = JSON.parse(JSON.stringify(intent));
  renamed.name = '矩阵-放弃-新';
  const fresh = await endsBlocked(runJournal(renamed, makeApi()));
  const freshKeys = fresh.journal.output_idempotency_keys.filter(Boolean);
  assert.equal(freshKeys.length, 2, 'the new journal creates BOTH outputs');
  for (const key of freshKeys) {
    assert.ok(!abandonedKeys.includes(key), `the new transaction never reuses an abandoned key (${key})`);
  }
  assert.notEqual(fresh.journal.stream_id, abandonedRoom, 'the renamed intent is a brand-new room');

  // The new keys are exactly what the server recorded for the new room's
  // outputs, and both steps really completed server-side.
  assert.equal(fresh.journal.steps['output:0'].status, 'done');
  assert.equal(fresh.journal.steps['output:1'].status, 'done');
  const recordedKeys = db.prepare('SELECT idempotency_key FROM output_idempotency WHERE room_id = ?')
    .all(fresh.journal.stream_id).map(row => row.idempotency_key);
  assert.deepEqual(recordsSorted(recordedKeys), recordsSorted(freshKeys), 'the server saw the new keys, and only the new keys');

  // The abandoned key stays a tombstone bound to the OLD room's deleted
  // subject — replaying it must be RESULT_GONE, not a resurrection.
  const tombstone = db.prepare('SELECT room_id, subject_id FROM output_idempotency WHERE idempotency_key = ?').get(abandonedKeys[0]);
  assert.equal(tombstone.room_id, abandonedRoom, 'the tombstone never rebinds to the new room');
  const replay = await request(`/api/v3/rooms/room:${abandonedRoom}/outputs`, {
    method: 'POST',
    body: JSON.stringify(pushOutputIntent('矩阵-放弃').payload),
    headers: { 'Idempotency-Key': abandonedKeys[0] }
  });
  assert.equal(replay.status, 409);
  assert.equal(replay.body.code, 'V3_OUTPUT_IDEMPOTENCY_RESULT_GONE');
});

function recordsSorted(values) {
  return [...values].sort();
}