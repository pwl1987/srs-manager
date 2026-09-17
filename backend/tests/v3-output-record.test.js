const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'srs-manager-v3-record-'));
process.env.DATA_DIR = dataDir;
process.env.RECORD_STORAGE_ROOT = path.join(dataDir, 'recordings');

const db = require('../database');
const outputService = require('../services/v3-output-service');
const recordTaskService = require('../services/record-task-service');
const assetService = require('../services/record-asset-service');
const workspaceService = require('../services/v3-workspace-service');
const capabilityService = require('../services/v3-capability-service');

function createStream(name) {
  return Number(db.prepare('INSERT INTO streams (name, protocol) VALUES (?, ?)').run(name, 'rtmp').lastInsertRowid);
}
test('V3 RECORD output follows STOPPED -> RECORDING -> COMPLETE operation semantics', () => {
  const streamId = createStream('v3-record-lifecycle');
  const created = outputService.createRecordOutput(streamId, {
    mode: 'RECORD', scene: 'LOCAL_RECORD', name: 'archive', format: 'mp4',
    protection: 'storage-policy', processing: { mode: 'PASSTHROUGH' },
    storage: { subdir: 'news', segment_seconds: 4 }
  });
  assert.equal(created.task.desired_state, 'STOPPED');
  assert.equal(created.task.runtime_state, 'STOPPED');

  let op = outputService.startOrStopRecord(created.task.id, 'RUNNING', { idempotency_key: 'record-start-1' }).operation;
  assert.equal(op.phase, 'VERIFYING');
  assert.equal(recordTaskService.getTask(created.task.id).runtime_state, 'STARTING');
  recordTaskService.updateRuntime(created.task.id, { runtime_state: 'RECORDING', bytes_written: 1880, last_growth_at: new Date().toISOString() });
  op = outputService.reconcileRecordOperation(op);
  assert.equal(op.phase, 'SUCCEEDED');
  op = outputService.startOrStopRecord(created.task.id, 'STOPPED', { idempotency_key: 'record-stop-1' }).operation;
  assert.equal(op.phase, 'VERIFYING');
  assert.equal(recordTaskService.getTask(created.task.id).runtime_state, 'STOPPING');
  recordTaskService.updateRuntime(created.task.id, { runtime_state: 'FINALIZING' });
  assert.equal(outputService.reconcileRecordOperation(op).phase, 'VERIFYING');
  recordTaskService.updateRuntime(created.task.id, { runtime_state: 'COMPLETE', bytes_written: 4096 });
  op = outputService.reconcileRecordOperation(op);
  assert.equal(op.phase, 'SUCCEEDED');
});

test('Record capability becomes available only with a live Record Worker heartbeat', () => {
  assert.equal(capabilityService.getCapabilities().runtime.record.available, false);
  assert.equal(recordTaskService.claimWorkerLease('record-cap-worker', 10000).acquired, true);
  assert.equal(capabilityService.getCapabilities().runtime.record.available, true);
  recordTaskService.clearWorkerHeartbeat('record-cap-worker');
});
test('Workspace projects RECORD output and filesystem evidence without leaking absolute paths', async () => {
  const streamId = createStream('v3-record-workspace');
  const created = outputService.createRecordOutput(streamId, {
    mode: 'RECORD', scene: 'LOCAL_RECORD', name: 'workspace-rec', format: 'ts',
    processing: { mode: 'PASSTHROUGH' }, storage: { subdir: 'workspace' }
  });
  recordTaskService.setDesiredState(created.task.id, 'RUNNING');
  recordTaskService.updateRuntime(created.task.id, { runtime_state: 'RECORDING', bytes_written: 8192, last_growth_at: new Date().toISOString() });
  const asset = assetService.createAsset(recordTaskService.getTask(created.task.id), { nonce: 'workspace' });
  assetService.updateAsset(asset.id, { state: 'RECORDING', size_bytes: 8192, segment_count: 2 });

  const workspace = await workspaceService.getWorkspace(`room:${streamId}`);
  const output = workspace.outputs.find(item => item.id === outputService.recordOutputId(created.task.id));
  assert.equal(output.mode, 'RECORD');
  assert.equal(output.runtime_state, 'RECORDING');
  assert.equal(output.evidence.local.level, 'OBSERVED');
  assert.equal(path.isAbsolute(output.asset.final_path || ''), false);
});

test.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
