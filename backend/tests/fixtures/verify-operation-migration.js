// Fixed verification script for the Phase-02 operations migration test. The
// child process reads its target DATA_DIR from the environment — the test
// never assembles code at runtime. It loads the REAL backend database module
// against the legacy database and reports what the migration produced.
const db = require('../../database');

const cols = db.prepare('PRAGMA table_info(operations)').all().map(column => column.name);
const row = db.prepare('SELECT type, subject_type, subject_id, state, idempotency_key FROM operations WHERE id = 1').get();
const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_operations_idempotency'").get();
console.log(JSON.stringify({ cols, row, idx }));
