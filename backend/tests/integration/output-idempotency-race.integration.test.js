const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

// PHASE-09-FIX-04 lifecycle correction: the idempotency CHECK, the resource
// CREATE and the key MAPPING must be one atomic unit. This regression spawns
// two independent Node processes — two separate SQLite connections against
// the same database file — issuing the SAME room + SAME key + SAME payload
// concurrently. BEGIN IMMEDIATE serializes them on the write lock: the loser
// re-reads the committed mapping inside its own transaction and replays.
// Acceptance for both PUSH and RECORD:
//   - exactly ONE output resource (no orphan task from the race window);
//   - exactly ONE idempotency mapping (the key never rebinds);
//   - both callers receive the SAME canonical output id;
//   - exactly one first creation and one idempotent replay.

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'srs-manager-output-race-'));
process.env.DATA_DIR = dataDir;
process.env.JWT_SECRET = 'test-output-race-secret';
process.env.SRS_API_URL = 'http://127.0.0.1:1985/api/v1';

const db = require('../../database');

const WORKER = path.join(__dirname, '..', 'fixtures', 'output-idempotency-race-worker.js');

// The fixed committed worker script runs under a literal `node` interpreter;
// only its argv varies. DATA_DIR points it at this test's database file.
function spawnWorker(streamId, mode, key) {
  return new Promise(resolve => {
    execFile('node', [WORKER, String(streamId), mode, key], {
      env: { ...process.env, DATA_DIR: dataDir, RECORD_STORAGE_ROOT: path.join(dataDir, 'recordings') }
    }, (error, stdout, stderr) => {
      const line = String(stdout || '').trim().split('\n').pop() || '';
      let parsed = null;
      try { parsed = JSON.parse(line); } catch { parsed = null; }
      resolve({ error, parsed, stderr: String(stderr || '') });
    });
  });
}

function seedStream(name) {
  return Number(db.prepare('INSERT INTO streams (name, protocol) VALUES (?, ?)').run(name, 'rtmp').lastInsertRowid);
}

test.after(() => {
  db.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('PUSH race: two processes, same room + key + payload → one task, one mapping, same output id', async () => {
  const streamId = seedStream('race-push-room');
  const [a, b] = await Promise.all([
    spawnWorker(streamId, 'PUSH', 'race-key-push'),
    spawnWorker(streamId, 'PUSH', 'race-key-push')
  ]);
  for (const worker of [a, b]) {
    assert.equal(worker.error, null, `worker process exited cleanly (${worker.stderr})`);
    assert.equal(worker.parsed?.ok, true, `worker reported failure: ${JSON.stringify(worker.parsed)}`);
  }
  assert.equal(a.parsed.task_id, b.parsed.task_id, 'both callers receive the SAME canonical output id');
  assert.deepEqual([a.parsed.replay, b.parsed.replay].sort(), [false, true], 'exactly one first creation and one replay');
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM forward_tasks WHERE stream_id = ?').get(streamId).count, 1,
    'exactly one output resource — the race window produces no orphan task');
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM output_idempotency WHERE idempotency_key = ?').get('race-key-push').count, 1,
    'exactly one mapping — the key never rebinds');
});

test('RECORD race: two processes, same room + key + payload → one task, one mapping, same output id', async () => {
  const streamId = seedStream('race-record-room');
  const [a, b] = await Promise.all([
    spawnWorker(streamId, 'RECORD', 'race-key-record'),
    spawnWorker(streamId, 'RECORD', 'race-key-record')
  ]);
  for (const worker of [a, b]) {
    assert.equal(worker.error, null, `worker process exited cleanly (${worker.stderr})`);
    assert.equal(worker.parsed?.ok, true, `worker reported failure: ${JSON.stringify(worker.parsed)}`);
  }
  assert.equal(a.parsed.task_id, b.parsed.task_id, 'both callers receive the SAME canonical output id');
  assert.deepEqual([a.parsed.replay, b.parsed.replay].sort(), [false, true], 'exactly one first creation and one replay');
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM record_tasks WHERE stream_id = ?').get(streamId).count, 1,
    'exactly one output resource — the race window produces no orphan task');
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM output_idempotency WHERE idempotency_key = ?').get('race-key-record').count, 1,
    'exactly one mapping — the key never rebinds');
});
