const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'srs-manager-v3-serve-'));
process.env.DATA_DIR = dataDir;

const db = require('../database');
const outPullService = require('../services/out-pull-service');
const capability = require('../services/v3-capability-service');
const outputService = require('../services/v3-output-service');

function createStream(name) {
  return Number(db.prepare('INSERT INTO streams (name, protocol) VALUES (?, ?)').run(name, 'rtmp').lastInsertRowid);
}

test('SERVE scenes persist truthful endpoint protection boundaries', (t) => {
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const streamId = createStream('serve-news');
  const partner = outputService.configureServeOutput(streamId, { scene: 'PARTNER_PULL', name: 'Partner A' });
  assert.deepEqual(partner.transports, ['rtmp', 'http-flv']);
  assert.equal(partner.endpoint_protections.rtmp, 'access-grant');
  assert.equal(partner.endpoint_protections['http-flv'], 'access-grant');
  assert.equal(partner.policy.require_grant, true);
  assert.equal(partner.policy.endpoint_enabled, false);
  const policy = outPullService.getPolicy(streamId);
  assert.equal(policy.v3_metadata.name, 'Partner A');
  assert.deepEqual(policy.v3_metadata.advertised_transports, ['rtmp', 'http-flv']);

  const cdn = outputService.configureServeOutput(streamId, { scene: 'CDN_ORIGIN', name: 'CDN Origin' });
  assert.equal(cdn.endpoint_protections.rtmp, 'none');
  assert.equal(cdn.endpoint_protections['http-flv'], 'none');
  assert.equal(cdn.endpoint_protections.hls, 'external-proxy');
  assert.equal(cdn.policy.require_grant, false);
  assert.equal(cdn.runtime_boundary.direct_hls_requires_external_boundary_for_protection, true);

  assert.throws(() => outputService.configureServeOutput(streamId, {
    scene: 'PROFESSIONAL', transports: ['hls'], endpoint_protections: { hls: 'access-grant' }
  }), /Unsupported protection|cannot enforce/);
  assert.throws(() => outputService.configureServeOutput(streamId, {
    scene: 'PROFESSIONAL', transports: ['rtmp', 'http-flv'],
    endpoint_protections: { rtmp: 'access-grant', 'http-flv': 'none' }
  }), /cannot mix open\/access-grant/);
});

test('SERVE enable and disable are idempotent audited operations', () => {
  const streamId = createStream('serve-control');
  outputService.configureServeOutput(streamId, { scene: 'PARTNER_PULL', name: 'Partner Control' });
  const stopped = outputService.startOrStopServe(streamId, 'STOPPED', { idempotency_key: 'serve-stop', requested_by: 'test' });
  assert.equal(stopped.operation.phase, 'SUCCEEDED');
  assert.equal(outPullService.getPolicy(streamId).endpoint_enabled, false);
  const replay = outputService.startOrStopServe(streamId, 'STOPPED', { idempotency_key: 'serve-stop', requested_by: 'test' });
  assert.equal(replay.reused, true);
  const started = outputService.startOrStopServe(streamId, 'RUNNING', { idempotency_key: 'serve-start', requested_by: 'test' });
  assert.equal(started.operation.phase, 'SUCCEEDED');
  assert.equal(outPullService.getPolicy(streamId).endpoint_enabled, true);

  const runtimeGap = capability.validateOutput({ mode: 'SERVE', transport: 'rtmp', protection: 'ip-allowlist' });
  assert.equal(runtimeGap.valid, false);
  assert.equal(runtimeGap.reason_code, 'RUNTIME_PROTECTION_UNAVAILABLE');
});