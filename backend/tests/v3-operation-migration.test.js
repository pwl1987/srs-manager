const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

test('Phase 02 adds operation idempotency storage without rewriting legacy operations', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'srs-manager-v3-op-migration-'));
  const dbFile = path.join(dataDir, 'srs-manager.db');
  const legacy = new Database(dbFile);
  legacy.exec(`CREATE TABLE operations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    subject_type TEXT NOT NULL,
    subject_id INTEGER NOT NULL,
    state TEXT NOT NULL DEFAULT 'QUEUED',
    requested_by TEXT,
    payload_json TEXT,
    result_json TEXT,
    error TEXT,
    started_at TEXT,
    completed_at TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );`);
  legacy.prepare("INSERT INTO operations(type, subject_type, subject_id, state) VALUES('PULL_SOURCE_SWITCH','pull_task',7,'VERIFYING')").run();
  legacy.close();

  // The child runs a FIXED committed script (tests/fixtures) with a literal
  // interpreter and receives the sandbox DATA_DIR through the environment —
  // no runtime-assembled code and no variable executable.
  const { execFileSync } = require('node:child_process');
  const out = execFileSync('node', [path.join(__dirname, 'fixtures', 'verify-operation-migration.js')], {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8',
    env: { ...process.env, DATA_DIR: dataDir }
  }).trim();
  const result = JSON.parse(out);
  assert.ok(result.cols.includes('idempotency_key'));
  assert.equal(result.row.type, 'PULL_SOURCE_SWITCH');
  assert.equal(result.row.state, 'VERIFYING');
  assert.equal(result.row.idempotency_key, null);
  assert.equal(result.idx.name, 'idx_operations_idempotency');
  fs.rmSync(dataDir, { recursive: true, force: true });
});
