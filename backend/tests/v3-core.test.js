const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'srs-manager-v3-core-'));
process.env.DATA_DIR = dataDir;

const evidence = require('../services/v3-evidence-service');
const capability = require('../services/v3-capability-service');
const health = require('../services/v3-health-service');
const operations = require('../services/v3-operation-core');

function workspaceBase(programState = 'LIVE') {
  return {
    program: { id: 'program:room:1', state: programState, evidence: { freshness: 'FRESH' } },
    sources: [], renditions: [], outputs: [],
    evidence: { workers: {}, srs: { available: true } }
  };
}

test('Evidence freshness is timestamped, source-aware and never treats null TTL as zero', () => {
  const now = Date.parse('2026-09-17T12:00:10Z');
  const fresh = evidence.normalize({ source: 'SRS API', observed_at: '2026-09-17T12:00:08Z' }, { now_ms: now });
  assert.equal(fresh.freshness, 'FRESH');
  assert.equal(fresh.ttl_ms, 5000);
  assert.equal(fresh.age_ms, 2000);
  const stale = evidence.normalize({ source: 'SRS API', observed_at: '2026-09-17T12:00:00Z' }, { now_ms: now });
  assert.equal(stale.freshness, 'STALE');
  assert.equal(evidence.normalize({ source: 'configuration', observed_at: null }).freshness, 'UNKNOWN');
});

test('Capability validation filters illegal combinations and preserves destination UNKNOWN semantics', () => {
  assert.equal(capability.validateOutput({ mode: 'PUSH', transport: 'hls' }).reason_code, 'PRODUCT_TRANSPORT_UNSUPPORTED');
  assert.equal(capability.validateOutput({ mode: 'SERVE', transport: 'hls', protection: 'access-grant' }, workspaceBase()).reason_code, 'PROTECTION_UNSUPPORTED');
  const serve = capability.validateOutput({ mode: 'SERVE', transport: 'http-flv', protection: 'access-grant', destination: { kind: 'custom' } }, workspaceBase());
  assert.equal(serve.valid, true);
  assert.equal(serve.override_allowed, true);
  assert.ok(serve.warnings.some(x => x.code === 'DESTINATION_CAPABILITY_UNKNOWN'));
  assert.equal(capability.validateOutput({ mode: 'RECORD', format: 'mp4', protection: 'storage-policy' }, workspaceBase()).reason_code, 'RUNTIME_RECORD_UNAVAILABLE');
});

test('Health is expected-vs-actual and remote UNKNOWN alone never creates a false failure', () => {
  const live = workspaceBase('LIVE');
  live.outputs.push({ id: 'output:push:1', mode: 'PUSH', control_mode: 'MANAGED', desired_state: 'RUNNING', runtime_state: 'RUNNING', evidence: { local: { freshness: 'FRESH' }, remote: { state: 'UNKNOWN', freshness: 'UNKNOWN' } } });
  assert.equal(health.evaluateWorkspace(live).status, 'NORMAL');

  const missing = workspaceBase('NO_PROGRAM');
  missing.sources.push({ kind: 'IN_PULL', compatibility: { desired_state: 'RUNNING' } });
  const result = health.evaluateWorkspace(missing);
  assert.equal(result.status, 'CRITICAL');
  assert.ok(result.reasons.some(x => x.code === 'PROGRAM_EXPECTED_NOT_OBSERVED'));

  const idle = workspaceBase('NO_PROGRAM');
  assert.equal(health.evaluateWorkspace(idle).status, 'NORMAL');
});

test('Operation core persists idempotency, conflict control and terminal transitions', () => {
  const first = operations.createOrReuse({ type: 'V3_OUTPUT_START', subject_type: 'forward_task', subject_id: 7, idempotency_key: 'key-a', requested_by: 'tester' });
  assert.equal(first.reused, false);
  const replay = operations.createOrReuse({ type: 'V3_OUTPUT_START', subject_type: 'forward_task', subject_id: 7, idempotency_key: 'key-a', requested_by: 'tester' });
  assert.equal(replay.reused, true);
  assert.equal(replay.operation.id, first.operation.id);
  const conflict = operations.createOrReuse({ type: 'V3_OUTPUT_STOP', subject_type: 'forward_task', subject_id: 7, idempotency_key: 'key-b' });
  assert.equal(conflict.conflict, true);
  let op = operations.transition(first.operation.id, 'RUNNING');
  assert.equal(op.phase, 'RUNNING');
  op = operations.transition(op.id, 'VERIFYING');
  op = operations.transition(op.id, 'SUCCEEDED', { result: { runtime_state: 'RUNNING' } });
  assert.equal(op.phase, 'SUCCEEDED');
  const next = operations.createOrReuse({ type: 'V3_OUTPUT_STOP', subject_type: 'forward_task', subject_id: 7, idempotency_key: 'key-b' });
  assert.equal(next.conflict, undefined);
  fs.rmSync(dataDir, { recursive: true, force: true });
});
