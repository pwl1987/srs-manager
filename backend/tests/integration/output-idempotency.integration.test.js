const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const jwt = require('jsonwebtoken');

// PHASE-09-FIX-04 Output creation idempotency (lifecycle correction): POST
// /v3/rooms/:roomId/outputs with an Idempotency-Key is a real server-side
// contract with a FROZEN state machine — a key represents ONE creation
// intent and its FIRST result, never a rebuild key:
//   NEW                        → CREATED (resource + mapping, one transaction)
//   CREATED + same fingerprint → 200 idempotent_replay, ZERO write side effects
//   CREATED + new fingerprint  → 409 V3_OUTPUT_IDEMPOTENCY_CONFLICT, first
//                                resource unchanged
//   subject deleted            → 409 V3_OUTPUT_IDEMPOTENCY_RESULT_GONE, the
//                                mapping stays as a tombstone and never
//                                rebinds; only a NEW key may create again
//   SERVE singleton superseded → 409 V3_OUTPUT_IDEMPOTENCY_RESULT_SUPERSEDED.
//                                PHASE-09-FIX-05: supersession is decided by
//                                the policy row's monotonic generation — every
//                                control-plane write increments it, a key
//                                replays only while the generation it
//                                recorded is current, and fields that later
//                                coincide again (A-B-A reconfiguration, a
//                                stop→start cycle) do NOT restore replay
//                                rights. Only the key of the LAST real write
//                                owns the current generation.
//                                PHASE-09-FIX-06: the (epoch, generation)
//                                authority moved into serve_policy_revisions,
//                                which SURVIVES deletion of the policy row —
//                                delete→recreate yields a NEW epoch (a new
//                                instance) with a strictly greater generation,
//                                so a tombstoned key stays RESULT_GONE even
//                                when the recreated policy is field-identical
//                                to its first result. Same-instance later
//                                writes remain RESULT_SUPERSEDED.
// The mapping row stores key + SHA-256 fingerprint + subject only — never
// the payload (PUSH target URLs are credential-bearing). The first-creation
// decision happens INSIDE the same BEGIN IMMEDIATE transaction as the
// resource create and the mapping insert. PUSH, RECORD and SERVE are all
// covered; requests without a key keep the legacy create-always behavior.

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'srs-manager-output-idem-'));
process.env.DATA_DIR = dataDir;
process.env.JWT_SECRET = 'test-output-idempotency-secret';
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

async function postOutput(streamId, payload, key = null) {
  return request(`/api/v3/rooms/room:${streamId}/outputs`, {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: key ? { 'Idempotency-Key': key } : {}
  });
}

const count = (sql, ...args) => db.prepare(sql).get(...args).count;
const one = (sql, ...args) => {
  const row = db.prepare(sql).get(...args);
  return row ? Object.values(row)[0] : undefined;
};

const PUSH_PAYLOAD = {
  mode: 'PUSH', name: '平台推流', scene: 'LIVE_PLATFORM_PUSH', transport: 'rtmp', protection: 'none',
  processing: { mode: 'PASSTHROUGH' },
  destination: { kind: 'CUSTOM', label: '平台推流', target_url: 'rtmp://cdn.example/live/key?sign=secret' }
};

const RECORD_PAYLOAD = {
  mode: 'RECORD', name: '本地录制', scene: 'LOCAL_RECORD', format: 'mp4', protection: 'storage-policy',
  processing: { mode: 'PASSTHROUGH' },
  storage: { subdir: 'news', filename_prefix: '本地录制', segment_seconds: 6, retention_days: 30 }
};

const SERVE_PAYLOAD = {
  mode: 'SERVE', name: '伙伴拉流', scene: 'PARTNER_PULL',
  transports: ['rtmp', 'http-flv'], consumer: { label: '伙伴拉流' }
};

async function seedRoom(name) {
  const created = await request('/api/streams', { method: 'POST', body: JSON.stringify({ name, protocol: 'rtmp' }) });
  assert.equal(created.status, 201);
  return created.body.stream.id;
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

test('PUSH: same key + same request replays the first task (200), never a duplicate', async () => {
  const streamId = await seedRoom('幂等-推流');
  const first = await postOutput(streamId, PUSH_PAYLOAD, 'idem-push-1');
  assert.equal(first.status, 201);
  assert.ok(first.body.output.task.id);
  assert.equal(first.body.output.idempotent_replay, undefined);

  const replay = await postOutput(streamId, PUSH_PAYLOAD, 'idem-push-1');
  assert.equal(replay.status, 200);
  assert.equal(replay.body.output.idempotent_replay, true);
  assert.equal(replay.body.output.task.id, first.body.output.task.id, 'the canonical output id is parseable and identical');
  assert.equal(count('SELECT COUNT(*) AS count FROM forward_tasks WHERE stream_id = ?', streamId), 1);
});

test('PUSH: same key + different target_url → 409, the original stays unchanged', async () => {
  const streamId = await seedRoom('幂等-推流冲突');
  const first = await postOutput(streamId, PUSH_PAYLOAD, 'idem-push-2');
  assert.equal(first.status, 201);

  const changed = JSON.parse(JSON.stringify(PUSH_PAYLOAD));
  changed.destination.target_url = 'rtmp://other.example/live/different';
  const conflict = await postOutput(streamId, changed, 'idem-push-2');
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.code, 'V3_OUTPUT_IDEMPOTENCY_CONFLICT');
  assert.equal(count('SELECT COUNT(*) AS count FROM forward_tasks WHERE stream_id = ?', streamId), 1);
  assert.equal(one('SELECT target_url FROM forward_tasks WHERE stream_id = ?', streamId), PUSH_PAYLOAD.destination.target_url);
});

test('RECORD: replay returns the same task; a different storage fingerprint conflicts', async () => {
  const streamId = await seedRoom('幂等-录制');
  const first = await postOutput(streamId, RECORD_PAYLOAD, 'idem-record-1');
  assert.equal(first.status, 201);
  const replay = await postOutput(streamId, RECORD_PAYLOAD, 'idem-record-1');
  assert.equal(replay.status, 200);
  assert.equal(replay.body.output.idempotent_replay, true);
  assert.equal(replay.body.output.task.id, first.body.output.task.id);
  assert.equal(count('SELECT COUNT(*) AS count FROM record_tasks WHERE stream_id = ?', streamId), 1);

  const changed = JSON.parse(JSON.stringify(RECORD_PAYLOAD));
  changed.storage.subdir = 'sports';
  changed.storage.segment_seconds = 12;
  const conflict = await postOutput(streamId, changed, 'idem-record-1');
  assert.equal(conflict.status, 409);
  assert.equal(count('SELECT COUNT(*) AS count FROM record_tasks WHERE stream_id = ?', streamId), 1);
  assert.equal(one('SELECT subdir FROM record_tasks WHERE stream_id = ?', streamId), 'news');
});

test('RECORD: a different format on the same key is a conflict, not a re-create', async () => {
  const streamId = await seedRoom('幂等-录制格式');
  await postOutput(streamId, RECORD_PAYLOAD, 'idem-record-2');
  const changed = JSON.parse(JSON.stringify(RECORD_PAYLOAD));
  changed.format = 'ts';
  const conflict = await postOutput(streamId, changed, 'idem-record-2');
  assert.equal(conflict.status, 409);
  assert.equal(one('SELECT format FROM record_tasks WHERE stream_id = ?', streamId), 'mp4');
});

test('SERVE: repeated key replays with zero write side effects, one policy row', async () => {
  const streamId = await seedRoom('幂等-分发');
  const first = await postOutput(streamId, SERVE_PAYLOAD, 'idem-serve-1');
  assert.equal(first.status, 201);
  assert.equal(first.body.output.id, `output:serve:${streamId}`);
  assert.equal(first.body.output.idempotent_replay, undefined);

  // Pin updated_at to a sentinel: a replay that (wrongly) re-ran updatePolicy
  // would overwrite it with CURRENT_TIMESTAMP — this detects ANY write, even
  // within the same wall-clock second.
  db.prepare("UPDATE out_pull_policies SET updated_at = '1999-01-01 00:00:00' WHERE stream_id = ?").run(streamId);
  const beforeReplay = JSON.stringify(db.prepare('SELECT * FROM out_pull_policies WHERE stream_id = ?').get(streamId));

  const replay = await postOutput(streamId, SERVE_PAYLOAD, 'idem-serve-1');
  assert.equal(replay.status, 200);
  assert.equal(replay.body.output.idempotent_replay, true);
  assert.equal(replay.body.output.id, `output:serve:${streamId}`);
  assert.equal(JSON.stringify(db.prepare('SELECT * FROM out_pull_policies WHERE stream_id = ?').get(streamId)), beforeReplay,
    'the replay is a pure read — the policy row is byte-identical, sentinel updated_at intact');
  const metadata = JSON.parse(one('SELECT v3_metadata_json FROM out_pull_policies WHERE stream_id = ?', streamId));
  assert.equal(metadata.scene, 'PARTNER_PULL');
  assert.deepEqual(metadata.advertised_transports, ['rtmp', 'http-flv']);
  assert.equal(metadata.endpoint_protections.rtmp, 'access-grant');

  const changed = JSON.parse(JSON.stringify(SERVE_PAYLOAD));
  changed.transports = ['hls'];
  const conflict = await postOutput(streamId, changed, 'idem-serve-1');
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.code, 'V3_OUTPUT_IDEMPOTENCY_CONFLICT');
  assert.equal(count('SELECT COUNT(*) AS count FROM out_pull_policies WHERE stream_id = ?', streamId), 1);
});

test('the idempotency evidence stores hashes, never the credential-bearing payload', async () => {
  const streamId = await seedRoom('幂等-证据');
  await postOutput(streamId, PUSH_PAYLOAD, 'idem-evidence-1');
  const row = db.prepare('SELECT * FROM output_idempotency WHERE idempotency_key = ?').get('idem-evidence-1');
  assert.ok(row, 'mapping row exists');
  assert.match(row.request_fingerprint, /^[0-9a-f]{64}$/, 'SHA-256 hex fingerprint');
  assert.equal(row.room_id, streamId);
  assert.equal(row.output_type, 'push');
  assert.equal(row.output_id, `output:push:${row.subject_id}`);
  const serialized = JSON.stringify(row);
  assert.ok(!serialized.includes('cdn.example'), 'no target_url plaintext');
  assert.ok(!serialized.includes('sign=secret'), 'no credential plaintext');
});

test('requests without a key keep the legacy create-always behavior', async () => {
  const streamId = await seedRoom('幂等-无键');
  const first = await postOutput(streamId, PUSH_PAYLOAD);
  assert.equal(first.status, 201);
  assert.equal(first.body.output.idempotent_replay, undefined);
  const second = await postOutput(streamId, PUSH_PAYLOAD);
  assert.equal(second.status, 201);
  assert.equal(count('SELECT COUNT(*) AS count FROM forward_tasks WHERE stream_id = ?', streamId), 2);
});

test('keys are scoped per room: the same key in another room creates normally', async () => {
  const roomA = await seedRoom('幂等-房间A');
  const roomB = await seedRoom('幂等-房间B');
  await postOutput(roomA, PUSH_PAYLOAD, 'idem-shared-key');
  const inB = await postOutput(roomB, PUSH_PAYLOAD, 'idem-shared-key');
  assert.equal(inB.status, 201, 'the key only binds inside the room that used it');
  assert.equal(count('SELECT COUNT(*) AS count FROM forward_tasks WHERE stream_id = ?', roomB), 1);
});

test('semantically identical replays after default normalization still match', async () => {
  const streamId = await seedRoom('幂等-规范化');
  await postOutput(streamId, PUSH_PAYLOAD, 'idem-norm-1');
  // Same effective configuration, expressed with explicit defaults the create
  // path would apply anyway — the fingerprint must normalize, not diff raw.
  const normalized = JSON.parse(JSON.stringify(PUSH_PAYLOAD));
  normalized.protection = 'NONE';
  normalized.processing = { mode: 'passthrough' };
  const replay = await postOutput(streamId, normalized, 'idem-norm-1');
  assert.equal(replay.status, 200);
  assert.equal(count('SELECT COUNT(*) AS count FROM forward_tasks WHERE stream_id = ?', streamId), 1);
});

test('PUSH: create → delete subject → same-key replay is RESULT_GONE, never a resurrection', async () => {
  const streamId = await seedRoom('幂等-删除终局-推');
  const first = await postOutput(streamId, PUSH_PAYLOAD, 'idem-gone-push-1');
  assert.equal(first.status, 201);
  const taskId = first.body.output.task.id;
  db.prepare('DELETE FROM forward_tasks WHERE id = ?').run(taskId);

  const replay = await postOutput(streamId, PUSH_PAYLOAD, 'idem-gone-push-1');
  assert.equal(replay.status, 409);
  assert.equal(replay.body.code, 'V3_OUTPUT_IDEMPOTENCY_RESULT_GONE');
  assert.equal(count('SELECT COUNT(*) AS count FROM forward_tasks WHERE stream_id = ?', streamId), 0, 'no new task is created');
  const tombstone = db.prepare('SELECT subject_id, output_id FROM output_idempotency WHERE idempotency_key = ?').get('idem-gone-push-1');
  assert.ok(tombstone, 'the mapping survives as tombstone evidence');
  assert.equal(tombstone.subject_id, taskId, 'the mapping never rebinds to another subject');

  const fresh = await postOutput(streamId, PUSH_PAYLOAD, 'idem-gone-push-2');
  assert.equal(fresh.status, 201, 'a NEW key may create again');
  assert.equal(count('SELECT COUNT(*) AS count FROM forward_tasks WHERE stream_id = ?', streamId), 1);
  assert.equal(count('SELECT COUNT(*) AS count FROM output_idempotency WHERE room_id = ?', streamId), 2, 'the old tombstone key and the new key coexist');
});

test('RECORD: create → delete subject → same-key replay is RESULT_GONE, never a resurrection', async () => {
  const streamId = await seedRoom('幂等-删除终局-录');
  const first = await postOutput(streamId, RECORD_PAYLOAD, 'idem-gone-record-1');
  assert.equal(first.status, 201);
  const taskId = first.body.output.task.id;
  db.prepare('DELETE FROM record_tasks WHERE id = ?').run(taskId);

  const replay = await postOutput(streamId, RECORD_PAYLOAD, 'idem-gone-record-1');
  assert.equal(replay.status, 409);
  assert.equal(replay.body.code, 'V3_OUTPUT_IDEMPOTENCY_RESULT_GONE');
  assert.equal(count('SELECT COUNT(*) AS count FROM record_tasks WHERE stream_id = ?', streamId), 0, 'no new task is created');
  const tombstone = db.prepare('SELECT subject_id FROM output_idempotency WHERE idempotency_key = ?').get('idem-gone-record-1');
  assert.equal(tombstone.subject_id, taskId, 'the mapping never rebinds');

  const fresh = await postOutput(streamId, RECORD_PAYLOAD, 'idem-gone-record-2');
  assert.equal(fresh.status, 201, 'a NEW key may create again');
  assert.equal(count('SELECT COUNT(*) AS count FROM record_tasks WHERE stream_id = ?', streamId), 1);
});

test('SERVE: key-A create → key-B reconfigures → stale key-A replay is RESULT_SUPERSEDED with no rollback', async () => {
  const streamId = await seedRoom('幂等-被取代');
  const keyA = await postOutput(streamId, SERVE_PAYLOAD, 'idem-superseded-a');
  assert.equal(keyA.status, 201);

  // A NEW key legitimately reconfigures the room's singleton SERVE policy.
  const keyB = await postOutput(streamId, {
    mode: 'SERVE', name: 'CDN 源站', scene: 'CDN_ORIGIN', endpoint_enabled: true
  }, 'idem-superseded-b');
  assert.equal(keyB.status, 201);
  assert.equal(count('SELECT COUNT(*) AS count FROM out_pull_policies WHERE stream_id = ?', streamId), 1);

  // Sentinel + full row snapshot: the stale retry must not write ANYTHING.
  db.prepare("UPDATE out_pull_policies SET updated_at = '1999-01-01 00:00:00' WHERE stream_id = ?").run(streamId);
  const beforeStale = JSON.stringify(db.prepare('SELECT * FROM out_pull_policies WHERE stream_id = ?').get(streamId));

  const stale = await postOutput(streamId, SERVE_PAYLOAD, 'idem-superseded-a');
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, 'V3_OUTPUT_IDEMPOTENCY_RESULT_SUPERSEDED');
  assert.equal(JSON.stringify(db.prepare('SELECT * FROM out_pull_policies WHERE stream_id = ?').get(streamId)), beforeStale,
    'key-B\'s current policy is byte-identical before and after the stale retry');
  const metadata = JSON.parse(one('SELECT v3_metadata_json FROM out_pull_policies WHERE stream_id = ?', streamId));
  assert.equal(metadata.scene, 'CDN_ORIGIN', 'the newer configuration wins, the old key cannot roll it back');

  // A serve start/stop (control-plane write) equally supersedes the key: the
  // stale replay must not silently restore endpoint_enabled.
  const stop = await request(`/api/v3/rooms/room:${streamId}/outputs/output:serve:${streamId}/stop`, {
    method: 'POST', headers: { 'Idempotency-Key': 'serve-stop-op' }
  });
  assert.equal(stop.status, 200);
  const staleAfterStop = await postOutput(streamId, {
    mode: 'SERVE', name: 'CDN 源站', scene: 'CDN_ORIGIN', endpoint_enabled: true
  }, 'idem-superseded-b');
  assert.equal(staleAfterStop.status, 409);
  assert.equal(staleAfterStop.body.code, 'V3_OUTPUT_IDEMPOTENCY_RESULT_SUPERSEDED');
  assert.equal(one('SELECT endpoint_enabled FROM out_pull_policies WHERE stream_id = ?', streamId), 0,
    'the stale replay did not flip endpoint_enabled back');
});

test('SERVE: policy row deleted → same-key replay is RESULT_GONE; a new key re-creates', async () => {
  const streamId = await seedRoom('幂等-删除终局-播');
  const first = await postOutput(streamId, SERVE_PAYLOAD, 'idem-gone-serve-1');
  assert.equal(first.status, 201);
  db.prepare('DELETE FROM out_pull_policies WHERE stream_id = ?').run(streamId);

  const replay = await postOutput(streamId, SERVE_PAYLOAD, 'idem-gone-serve-1');
  assert.equal(replay.status, 409);
  assert.equal(replay.body.code, 'V3_OUTPUT_IDEMPOTENCY_RESULT_GONE');
  const tombstone = db.prepare('SELECT subject_id, output_id FROM output_idempotency WHERE idempotency_key = ?').get('idem-gone-serve-1');
  assert.ok(tombstone, 'the mapping survives as tombstone evidence');
  assert.equal(tombstone.output_id, `output:serve:${streamId}`, 'the mapping never rebinds');

  const fresh = await postOutput(streamId, SERVE_PAYLOAD, 'idem-gone-serve-2');
  assert.equal(fresh.status, 201, 'a NEW key may configure again');
  assert.equal(count('SELECT COUNT(*) AS count FROM out_pull_policies WHERE stream_id = ?', streamId), 1);
});

// ---------------------------------------------------------------------------
// PHASE-09-FIX-05 SERVE generation / ABA lifecycle regressions.
// ---------------------------------------------------------------------------

test('SERVE ABA: key-C restores key-A\'s exact fields → key-A replay stays RESULT_SUPERSEDED, zero writes', async () => {
  const streamId = await seedRoom('幂等-ABA取代');
  const keyA = await postOutput(streamId, SERVE_PAYLOAD, 'idem-aba-a');
  assert.equal(keyA.status, 201);
  const generationA = one('SELECT generation FROM out_pull_policies WHERE stream_id = ?', streamId);
  assert.equal(one('SELECT result_revision FROM output_idempotency WHERE idempotency_key = ?', 'idem-aba-a'), generationA,
    'the mapping pins the generation its first write produced');
  const fieldsAtA = JSON.stringify(db.prepare(
    'SELECT endpoint_enabled, accepting_new_sessions, require_grant, v3_metadata_json FROM out_pull_policies WHERE stream_id = ?'
  ).get(streamId));

  const keyB = await postOutput(streamId, {
    mode: 'SERVE', name: 'CDN 源站', scene: 'CDN_ORIGIN', endpoint_enabled: true
  }, 'idem-aba-b');
  assert.equal(keyB.status, 201);

  // The ABA step: key-C reconfigures back to EXACTLY key-A's request, so every
  // policy field becomes semantically identical to key-A's first result.
  const keyC = await postOutput(streamId, SERVE_PAYLOAD, 'idem-aba-c');
  assert.equal(keyC.status, 201);
  assert.equal(one('SELECT generation FROM out_pull_policies WHERE stream_id = ?', streamId), generationA + 2,
    'two later real writes moved the generation on');
  assert.equal(JSON.stringify(db.prepare(
    'SELECT endpoint_enabled, accepting_new_sessions, require_grant, v3_metadata_json FROM out_pull_policies WHERE stream_id = ?'
  ).get(streamId)), fieldsAtA, 'the ABA step restored every field of key-A\'s first result');

  // Fields coincide, generation does not: key-A must not regain replay rights.
  db.prepare("UPDATE out_pull_policies SET updated_at = '1999-01-01 00:00:00' WHERE stream_id = ?").run(streamId);
  const beforeStale = JSON.stringify(db.prepare('SELECT * FROM out_pull_policies WHERE stream_id = ?').get(streamId));
  const stale = await postOutput(streamId, SERVE_PAYLOAD, 'idem-aba-a');
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, 'V3_OUTPUT_IDEMPOTENCY_RESULT_SUPERSEDED');
  assert.equal(JSON.stringify(db.prepare('SELECT * FROM out_pull_policies WHERE stream_id = ?').get(streamId)), beforeStale,
    'the stale retry wrote nothing — sentinel updated_at and generation intact');
});

test('SERVE: stop → start restores identical fields, but key-A stays RESULT_SUPERSEDED', async () => {
  const streamId = await seedRoom('幂等启停ABA');
  const payload = { ...JSON.parse(JSON.stringify(SERVE_PAYLOAD)), endpoint_enabled: true };
  const keyA = await postOutput(streamId, payload, 'idem-ss-aba-a');
  assert.equal(keyA.status, 201);

  const stop = await request(`/api/v3/rooms/room:${streamId}/outputs/output:serve:${streamId}/stop`, {
    method: 'POST', headers: { 'Idempotency-Key': 'ss-aba-stop' }
  });
  assert.equal(stop.status, 200);
  const start = await request(`/api/v3/rooms/room:${streamId}/outputs/output:serve:${streamId}/start`, {
    method: 'POST', headers: { 'Idempotency-Key': 'ss-aba-start' }
  });
  assert.equal(start.status, 200);
  assert.equal(one('SELECT endpoint_enabled FROM out_pull_policies WHERE stream_id = ?', streamId), 1,
    'the start restored the field value of key-A\'s first result');

  const stale = await postOutput(streamId, payload, 'idem-ss-aba-a');
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, 'V3_OUTPUT_IDEMPOTENCY_RESULT_SUPERSEDED');
});

test('SERVE: immediate same-key replay is a pure read — generation, updated_at and the full row untouched', async () => {
  const streamId = await seedRoom('幂等零写终局');
  const first = await postOutput(streamId, SERVE_PAYLOAD, 'idem-generation-pure');
  assert.equal(first.status, 201);
  const generation = one('SELECT generation FROM out_pull_policies WHERE stream_id = ?', streamId);

  db.prepare("UPDATE out_pull_policies SET updated_at = '1999-01-01 00:00:00' WHERE stream_id = ?").run(streamId);
  const before = JSON.stringify(db.prepare('SELECT * FROM out_pull_policies WHERE stream_id = ?').get(streamId));

  const replay = await postOutput(streamId, SERVE_PAYLOAD, 'idem-generation-pure');
  assert.equal(replay.status, 200);
  assert.equal(replay.body.output.idempotent_replay, true);
  assert.equal(JSON.stringify(db.prepare('SELECT * FROM out_pull_policies WHERE stream_id = ?').get(streamId)), before,
    'the replay is a pure read — generation, sentinel updated_at and every field byte-identical');
  assert.equal(one('SELECT generation FROM out_pull_policies WHERE stream_id = ?', streamId), generation,
    'generation does not move on a replay');
});

test('SERVE: after ABA only the newest key owns the current generation and replays', async () => {
  const streamId = await seedRoom('幂等最新键');
  await postOutput(streamId, SERVE_PAYLOAD, 'idem-owner-a');
  await postOutput(streamId, {
    mode: 'SERVE', name: 'CDN 源站', scene: 'CDN_ORIGIN', endpoint_enabled: true
  }, 'idem-owner-b');
  const keyC = await postOutput(streamId, SERVE_PAYLOAD, 'idem-owner-c');
  assert.equal(keyC.status, 201);
  const currentGeneration = one('SELECT generation FROM out_pull_policies WHERE stream_id = ?', streamId);

  // key-B's write is no longer the last real write → superseded like key-A.
  const staleB = await postOutput(streamId, {
    mode: 'SERVE', name: 'CDN 源站', scene: 'CDN_ORIGIN', endpoint_enabled: true
  }, 'idem-owner-b');
  assert.equal(staleB.status, 409);
  assert.equal(staleB.body.code, 'V3_OUTPUT_IDEMPOTENCY_RESULT_SUPERSEDED');

  // key-C's write IS the last real write: its replay is a pure 200.
  db.prepare("UPDATE out_pull_policies SET updated_at = '1999-01-01 00:00:00' WHERE stream_id = ?").run(streamId);
  const before = JSON.stringify(db.prepare('SELECT * FROM out_pull_policies WHERE stream_id = ?').get(streamId));
  const replayC = await postOutput(streamId, SERVE_PAYLOAD, 'idem-owner-c');
  assert.equal(replayC.status, 200);
  assert.equal(replayC.body.output.idempotent_replay, true);
  assert.equal(JSON.stringify(db.prepare('SELECT * FROM out_pull_policies WHERE stream_id = ?').get(streamId)), before,
    'the newest key replays with zero writes');
  assert.equal(one('SELECT generation FROM out_pull_policies WHERE stream_id = ?', streamId), currentGeneration);
});

// ---------------------------------------------------------------------------
// PHASE-09-FIX-06 SERVE persistent generation / delete-recreate tombstone
// regressions. The pre-FIX-06 generation lived inside the deletable policy
// row: deleting the row and recreating the SAME configuration with a NEW key
// restarted generation at 1, handing the old tombstoned key its identity back
// (200 replay resurrection). The authority is now the per-room persistent
// serve_policy_revisions (epoch + generation): delete→recreate is a NEW epoch
// with a strictly greater generation, and the old key stays RESULT_GONE.
// ---------------------------------------------------------------------------

test('FIX-06 F1: delete → key-B recreates the SAME payload → key-A stays RESULT_GONE forever', async () => {
  const streamId = await seedRoom('幂等-删建同配');
  const keyA = await postOutput(streamId, SERVE_PAYLOAD, 'idem-f1-a');
  assert.equal(keyA.status, 201);
  const pinnedA = db.prepare('SELECT subject_id, output_id, result_revision, result_epoch FROM output_idempotency WHERE idempotency_key = ?').get('idem-f1-a');

  db.prepare('DELETE FROM out_pull_policies WHERE stream_id = ?').run(streamId);
  const gone = await postOutput(streamId, SERVE_PAYLOAD, 'idem-f1-a');
  assert.equal(gone.status, 409);
  assert.equal(gone.body.code, 'V3_OUTPUT_IDEMPOTENCY_RESULT_GONE');

  // The exact resurrection probe: a NEW key legally recreates the SAME
  // configuration; the new policy row is field-identical to key-A's first
  // result (and, pre-FIX-06, generation-identical). key-A must stay dead.
  const keyB = await postOutput(streamId, SERVE_PAYLOAD, 'idem-f1-b');
  assert.equal(keyB.status, 201);
  assert.equal(count('SELECT COUNT(*) AS count FROM out_pull_policies WHERE stream_id = ?', streamId), 1);
  const row = db.prepare('SELECT epoch, generation FROM out_pull_policies WHERE stream_id = ?').get(streamId);
  assert.equal(row.epoch, 2, 'recreate after absence is a NEW instance');
  assert.equal(row.generation, 2, 'generation strictly exceeds the deleted instance\'s whole history');

  db.prepare("UPDATE out_pull_policies SET updated_at = '1999-01-01 00:00:00' WHERE stream_id = ?").run(streamId);
  const beforeStale = JSON.stringify(db.prepare('SELECT * FROM out_pull_policies WHERE stream_id = ?').get(streamId));
  const resurrected = await postOutput(streamId, SERVE_PAYLOAD, 'idem-f1-a');
  assert.equal(resurrected.status, 409);
  assert.equal(resurrected.body.code, 'V3_OUTPUT_IDEMPOTENCY_RESULT_GONE');
  assert.equal(JSON.stringify(db.prepare('SELECT * FROM out_pull_policies WHERE stream_id = ?').get(streamId)), beforeStale,
    'the failed resurrection wrote nothing — sentinel updated_at, epoch and generation intact');

  const stillPinnedA = db.prepare('SELECT subject_id, output_id, result_revision, result_epoch FROM output_idempotency WHERE idempotency_key = ?').get('idem-f1-a');
  assert.deepEqual(stillPinnedA, pinnedA, 'the tombstone mapping never rebinds');

  const replayB = await postOutput(streamId, SERVE_PAYLOAD, 'idem-f1-b');
  assert.equal(replayB.status, 200, 'the newest key owns the current instance and replays');
  assert.equal(replayB.body.output.idempotent_replay, true);
});

test('FIX-06 F2: delete → key-B recreates a DIFFERENT payload → key-A stays terminally dead', async () => {
  const streamId = await seedRoom('幂等-删建异配');
  await postOutput(streamId, SERVE_PAYLOAD, 'idem-f2-a');
  db.prepare('DELETE FROM out_pull_policies WHERE stream_id = ?').run(streamId);
  const keyB = await postOutput(streamId, {
    mode: 'SERVE', name: 'CDN 源站', scene: 'CDN_ORIGIN', endpoint_enabled: true
  }, 'idem-f2-b');
  assert.equal(keyB.status, 201);

  const stale = await postOutput(streamId, SERVE_PAYLOAD, 'idem-f2-a');
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, 'V3_OUTPUT_IDEMPOTENCY_RESULT_GONE');
  const metadata = JSON.parse(one('SELECT v3_metadata_json FROM out_pull_policies WHERE stream_id = ?', streamId));
  assert.equal(metadata.scene, 'CDN_ORIGIN', 'the dead key never adopts the newer configuration');
});

test('FIX-06 F3: after delete→recreate the latest key replays pure and pins the current revision', async () => {
  const streamId = await seedRoom('幂等-删建最新键');
  await postOutput(streamId, SERVE_PAYLOAD, 'idem-f3-a');
  db.prepare('DELETE FROM out_pull_policies WHERE stream_id = ?').run(streamId);
  const gone = await postOutput(streamId, SERVE_PAYLOAD, 'idem-f3-a');
  assert.equal(gone.status, 409);
  assert.equal(gone.body.code, 'V3_OUTPUT_IDEMPOTENCY_RESULT_GONE');

  const keyB = await postOutput(streamId, SERVE_PAYLOAD, 'idem-f3-b');
  assert.equal(keyB.status, 201);
  const stale = await postOutput(streamId, SERVE_PAYLOAD, 'idem-f3-a');
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, 'V3_OUTPUT_IDEMPOTENCY_RESULT_GONE');

  db.prepare("UPDATE out_pull_policies SET updated_at = '1999-01-01 00:00:00' WHERE stream_id = ?").run(streamId);
  const before = JSON.stringify(db.prepare('SELECT * FROM out_pull_policies WHERE stream_id = ?').get(streamId));
  const replayB = await postOutput(streamId, SERVE_PAYLOAD, 'idem-f3-b');
  assert.equal(replayB.status, 200);
  assert.equal(replayB.body.output.idempotent_replay, true);
  assert.equal(JSON.stringify(db.prepare('SELECT * FROM out_pull_policies WHERE stream_id = ?').get(streamId)), before,
    'the latest key replays with zero writes');
  const row = db.prepare('SELECT epoch, generation FROM out_pull_policies WHERE stream_id = ?').get(streamId);
  const pinnedB = db.prepare('SELECT result_epoch, result_revision FROM output_idempotency WHERE idempotency_key = ?').get('idem-f3-b');
  assert.deepEqual({ epoch: row.epoch, revision: row.generation }, { epoch: pinnedB.result_epoch, revision: pinnedB.result_revision },
    'the live instance/revision matches exactly the latest key\'s mapping');
});

test('FIX-06 F4: two delete→recreate rounds — epochs and generations never wrap or reuse an identity', async () => {
  const streamId = await seedRoom('幂等-删建两轮');
  await postOutput(streamId, SERVE_PAYLOAD, 'idem-f4-a');                  // instance 1
  db.prepare('DELETE FROM out_pull_policies WHERE stream_id = ?').run(streamId);
  await postOutput(streamId, SERVE_PAYLOAD, 'idem-f4-b');                  // instance 2
  db.prepare('DELETE FROM out_pull_policies WHERE stream_id = ?').run(streamId);
  const keyC = await postOutput(streamId, SERVE_PAYLOAD, 'idem-f4-c');     // instance 3
  assert.equal(keyC.status, 201);

  const row = db.prepare('SELECT epoch, generation FROM out_pull_policies WHERE stream_id = ?').get(streamId);
  assert.equal(row.epoch, 3, 'third instance');
  assert.equal(row.generation, 3, 'generation remembers all three writes');
  const authority = db.prepare('SELECT epoch, generation FROM serve_policy_revisions WHERE stream_id = ?').get(streamId);
  assert.deepEqual(authority, row, 'the persistent authority survives two deletions and matches the live row');

  for (const deadKey of ['idem-f4-a', 'idem-f4-b']) {
    const stale = await postOutput(streamId, SERVE_PAYLOAD, deadKey);
    assert.equal(stale.status, 409, `${deadKey} never resurrects`);
    assert.equal(stale.body.code, 'V3_OUTPUT_IDEMPOTENCY_RESULT_GONE');
  }
  const replayC = await postOutput(streamId, SERVE_PAYLOAD, 'idem-f4-c');
  assert.equal(replayC.status, 200);
  assert.equal(replayC.body.output.idempotent_replay, true);
});
