const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'srs-manager-phase06-'));
process.env.DATA_DIR = dataDir;
process.env.RECORD_STORAGE_ROOT = path.join(dataDir, 'recordings');

const db = require('../database');
const pushTaskService = require('../services/push-task-service');
const recordTaskService = require('../services/record-task-service');
const runPlanService = require('../services/run-plan-service');
const sessionService = require('../services/session-service');
const preflightService = require('../services/preflight-service');

const streamId = Number(db.prepare("INSERT INTO streams (name, protocol) VALUES ('phase06-room', 'rtmp')").run().lastInsertRowid);
const push = pushTaskService.createTask({ stream_id: streamId, target_type: 'test', target_url: 'rtmp://10.30.5.199/live/phase06-out' });
const record = recordTaskService.createTask({ stream_id: streamId, name: 'phase06-record', format: 'mp4' });
const sourceId = `source:in_push:legacy-${streamId}`;
test('Session freezes a Run Plan snapshot so later plan edits do not rewrite the current Session', () => {
  const plan = runPlanService.createPlan({
    stream_id: streamId,
    name: 'Evening News Standard',
    program_source_id: sourceId,
    outputs: [
      { output_ref: `output:push:${push.id}`, importance: 'REQUIRED', auto_start: true },
      { output_ref: `output:record:${record.id}`, importance: 'OPTIONAL', auto_start: true }
    ]
  });
  const session = sessionService.createSession({ stream_id: streamId, run_plan_id: plan.id, title: '2026-09-18 Evening News' });
  assert.equal(session.lifecycle_state, 'PREP');
  assert.deepEqual(session.outputs.map(x => [x.output_ref, x.importance]), [
    [`output:push:${push.id}`, 'REQUIRED'],
    [`output:record:${record.id}`, 'OPTIONAL']
  ]);

  runPlanService.updatePlan(plan.id, {
    outputs: [{ output_ref: `output:record:${record.id}`, importance: 'REQUIRED', auto_start: true }]
  });
  const frozen = sessionService.getSession(session.id);
  assert.deepEqual(frozen.outputs.map(x => [x.output_ref, x.importance]), [
    [`output:push:${push.id}`, 'REQUIRED'],
    [`output:record:${record.id}`, 'OPTIONAL']
  ]);
});
test('Preflight treats optional runtime gaps as warnings and can mark a Session READY', async () => {
  const session = sessionService.getActiveSessionForStream(streamId);
  const workspace = {
    evidence: { srs: { available: true } },
    sources: [{ id: sourceId, availability: 'ONLINE' }],
    outputs: [
      { id: `output:push:${push.id}`, mode: 'PUSH', media_ref: 'rendition:program-original', control_mode: 'MANAGED' },
      { id: `output:record:${record.id}`, mode: 'RECORD', media_ref: 'rendition:program-original' }
    ],
    capabilities: { runtime: {
      push_worker: { available: true },
      record: { available: false, storage: { low_space: false } },
      transcode_worker: { available: true }
    } }
  };
  const result = await preflightService.evaluateSession(session.id, { workspace, mark_ready: true });
  assert.equal(result.status, 'READY_WITH_WARNING');
  assert.equal(result.summary.blockers, 0);
  assert.ok(result.checks.some(x => x.code === 'RECORD_WORKER_UNAVAILABLE' && x.severity === 'WARNING'));
  assert.equal(sessionService.getSession(session.id).lifecycle_state, 'READY');
});

test('Preflight blocks a Session when a REQUIRED planned Output is missing', async () => {
  const first = sessionService.getActiveSessionForStream(streamId);
  assert.equal(first.lifecycle_state, 'READY');
  sessionService.transition(first.id, 'ENDED');

  const plan = runPlanService.createPlan({
    stream_id: streamId,
    name: 'Required Output Plan',
    program_source_id: sourceId,
    outputs: [{ output_ref: `output:push:${push.id}`, importance: 'REQUIRED', auto_start: true }]
  });
  const session = sessionService.createSession({ stream_id: streamId, run_plan_id: plan.id, title: 'Required Output Session' });
  const workspace = {
    evidence: { srs: { available: true } },
    sources: [{ id: sourceId, availability: 'ONLINE' }],
    outputs: [],
    capabilities: { runtime: {
      push_worker: { available: true },
      record: { available: true, storage: { low_space: false } },
      transcode_worker: { available: true }
    } }
  };
  const result = await preflightService.evaluateSession(session.id, { workspace, mark_ready: true });
  assert.equal(result.status, 'BLOCKED');
  assert.ok(result.checks.some(x => x.code === 'PLANNED_OUTPUT_MISSING' && x.severity === 'BLOCKER'));
  assert.equal(sessionService.getSession(session.id).lifecycle_state, 'PREP');
});

test.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
