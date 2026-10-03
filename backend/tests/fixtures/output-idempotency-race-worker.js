// Fixed race worker for the PHASE-09-FIX-04 output idempotency concurrency
// regression. The child reads its target DATA_DIR from the environment and
// its room / mode / key from argv, then runs the REAL create service against
// the REAL database — the test spawns two of these in parallel (two separate
// SQLite connections on the same file) to prove the first-creation decision
// is serialized inside the BEGIN IMMEDIATE write transaction.
const streamId = Number(process.argv[2]);
const mode = String(process.argv[3] || 'PUSH').toUpperCase();
const idempotencyKey = String(process.argv[4] || '');

const PAYLOADS = {
  PUSH: {
    mode: 'PUSH', name: 'race-push', scene: 'LIVE_PLATFORM_PUSH', transport: 'rtmp', protection: 'none',
    processing: { mode: 'PASSTHROUGH' },
    destination: { kind: 'CUSTOM', label: 'race-push', target_url: 'rtmp://race.example/live/key?sign=secret' }
  },
  RECORD: {
    mode: 'RECORD', name: 'race-record', scene: 'LOCAL_RECORD', format: 'mp4', protection: 'storage-policy',
    processing: { mode: 'PASSTHROUGH' },
    storage: { subdir: 'race', filename_prefix: 'race', segment_seconds: 6 }
  }
};

const payload = PAYLOADS[mode];
if (!payload || !streamId || !idempotencyKey) {
  console.log(JSON.stringify({ ok: false, message: `invalid race worker invocation: ${process.argv.slice(2)}` }));
} else {
  try {
    const outputService = require('../../services/v3-output-service');
    const result = mode === 'RECORD'
      ? outputService.createRecordOutput(streamId, payload, { idempotency_key: idempotencyKey })
      : outputService.createPushOutput(streamId, payload, { idempotency_key: idempotencyKey });
    console.log(JSON.stringify({ ok: true, task_id: result.task.id, replay: result.idempotent_replay === true }));
  } catch (error) {
    console.log(JSON.stringify({ ok: false, message: error.message }));
  }
}
