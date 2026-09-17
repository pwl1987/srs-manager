const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'srs-manager-v04-migration-'));
process.env.DATA_DIR = dataDir;
const file = path.join(dataDir, 'srs-manager.db');

const legacy = new Database(file);
legacy.exec(`
  CREATE TABLE forward_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    stream_id INTEGER NOT NULL,
    external_source_id INTEGER,
    target_type TEXT NOT NULL,
    target_url TEXT NOT NULL,
    enabled INTEGER DEFAULT 1,
    status TEXT DEFAULT 'idle',
    error_message TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
`);
legacy.prepare("INSERT INTO forward_tasks (stream_id, target_type, target_url, enabled) VALUES (1, 'custom_rtmp', 'rtmp://platform.example.org/live/key', 1)").run();
legacy.close();

const db = require('../database');

test('v0.3 forward_tasks upgrade adds v0.4 runtime columns before indexing and preserves intent', (t) => {
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const columns = new Set(db.prepare('PRAGMA table_info(forward_tasks)').all().map(row => row.name));
  for (const name of ['execution_mode', 'desired_state', 'runtime_state', 'attempt', 'worker_instance_id', 'updated_at']) {
    assert.equal(columns.has(name), true, `${name} should exist after migration`);
  }
  const task = db.prepare('SELECT * FROM forward_tasks WHERE id = 1').get();
  assert.equal(task.execution_mode, 'srs_dynamic');
  assert.equal(task.desired_state, 'RUNNING');
  assert.equal(task.runtime_state, 'LEGACY_DYNAMIC');
  const index = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_forward_tasks_desired_runtime'").get();
  assert.equal(index.name, 'idx_forward_tasks_desired_runtime');
});
