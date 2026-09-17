const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const contractDir = path.resolve(__dirname, '../../docs/product/contracts/workspace-v3');
const readJson = name => JSON.parse(fs.readFileSync(path.join(contractDir, name), 'utf8'));
const contract = readJson('contract.json');
const aggregate = readJson('workspace-aggregate.example.json');
const acceptance = readJson('acceptance-cases.json');

function collectKeys(value, out = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, out);
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      out.push(key);
      collectKeys(child, out);
    }
  }
  return out;
}

test('Workspace V3 Phase 00 contract versions and mandatory V2 mappings are frozen', () => {
  assert.equal(contract.contract_version, 'workspace-v3-phase00.1');
  assert.equal(aggregate.contract_version, contract.contract_version);
  assert.equal(acceptance.contract_version, contract.contract_version);

  const mapped = new Set(contract.v2_to_v3.flatMap(item => item.v2));
  for (const fact of [
    'streams', 'external_sources', 'pull_tasks', 'pull_task_sources',
    'SRS publisher/client observation', 'transcode_templates',
    'stream_transcode_bindings', 'forward_tasks', 'out_pull_policies',
    'access_grants', 'out_pull_sessions', 'cdn_channels',
    'distribution_requests', 'operations', 'hook_events', 'auth_keys'
  ]) assert.ok(mapped.has(fact), `missing V2 mapping: ${fact}`);

  assert.ok(contract.v2_to_v3.every(item => item.lossless === true));
});

test('Output capability matrix rejects impossible V3 combinations', () => {
  assert.deepEqual(contract.output.modes.PUSH.transports, ['rtmp', 'rtmps', 'srt']);
  assert.deepEqual(contract.output.modes.SERVE.transports, ['rtmp', 'http-flv', 'hls']);
  assert.deepEqual(contract.output.modes.RECORD.formats, ['ts', 'mp4', 'audio']);
  assert.ok(!contract.output.modes.PUSH.transports.includes('hls'));
  assert.ok(!contract.output.modes.PUSH.transports.includes('http-flv'));
  assert.equal(contract.output.modes.SERVE.multi_endpoint, true);
  assert.equal(contract.output.modes.PUSH.multi_endpoint, false);
});

test('Operation projection preserves existing pull-switch history without inventing runtime facts', () => {
  const projection = contract.operation.v2_pull_switch_projection;
  assert.deepEqual(projection.QUEUED, ['QUEUED', 'REQUESTED']);
  assert.deepEqual(projection.STOPPING, ['RUNNING', 'STOPPING_OLD_SOURCE']);
  assert.deepEqual(projection.STARTING, ['RUNNING', 'STARTING_TARGET']);
  assert.deepEqual(projection.VERIFYING, ['VERIFYING', 'NONE']);
  assert.deepEqual(projection.SUCCEEDED, ['SUCCEEDED', 'NONE']);
  assert.deepEqual(projection.FAILED, ['FAILED', 'NONE']);
  assert.deepEqual(projection.CANCELLED, ['CANCELLED', 'NONE']);
});

test('Workspace aggregate example follows frozen shape and contains no raw secret fields', () => {
  for (const key of contract.aggregate.top_level) {
    assert.ok(Object.prototype.hasOwnProperty.call(aggregate, key), `aggregate missing ${key}`);
  }
  const keys = new Set(collectKeys(aggregate));
  for (const forbidden of contract.aggregate.forbidden_secret_fields) {
    assert.equal(keys.has(forbidden), false, `raw secret field leaked: ${forbidden}`);
  }

  for (const output of aggregate.outputs) {
    if (output.mode === 'PUSH') assert.ok(contract.output.modes.PUSH.transports.includes(output.transport));
    if (output.mode === 'SERVE') {
      for (const endpoint of output.endpoints || []) {
        assert.ok(contract.output.modes.SERVE.transports.includes(endpoint.transport));
      }
    }
  }
});

test('Phase 00 acceptance fixtures cover truthfulness and compatibility boundaries', () => {
  const ids = new Set(acceptance.cases.map(item => item.id));
  for (const id of [
    'external-publisher-program', 'managed-pull-attribution', 'pull-running-no-publisher',
    'managed-push-local-only', 'legacy-dynamic-forward', 'serve-zero-viewers',
    'direct-hls-boundary', 'transcode-runtime-without-derived-media',
    'provider-channel-config-only', 'secret-redaction', 'pull-switch-operation',
    'record-not-yet-supported'
  ]) assert.ok(ids.has(id), `missing acceptance case: ${id}`);

  assert.equal(aggregate.capabilities.record, false);
  assert.equal(contract.capability.unsupported_override.product_or_runtime, false);
  assert.equal(contract.capability.unsupported_override.destination_unknown, true);
});
