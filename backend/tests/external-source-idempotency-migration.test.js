const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

// PHASE-09 FIX: a database created before external_sources.idempotency_key must
// gain the column + unique partial index via ensureColumn while keeping every
// existing row intact. Own process (node --test), so seeding before
// requiring ../database is safe.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'srs-manager-ext-src-idem-mig-'));
process.env.DATA_DIR = dataDir;
process.env.SRS_API_URL = 'http://127.0.0.1:1985/api/v1';

const legacyConn = new Database(path.join(dataDir, 'srs-manager.db'));
legacyConn.exec(`
  CREATE TABLE external_sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    source_url TEXT NOT NULL,
    protocol TEXT DEFAULT 'rtmp',
    pull_mode TEXT DEFAULT 'pull',
    status TEXT DEFAULT 'active',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  INSERT INTO external_sources (name, source_url, protocol, pull_mode, status)
    VALUES ('存量上游', 'rtmp://legacy.example/live/a', 'rtmp', 'pull', 'active');
`);
legacyConn.close();

const db = require('../database');

test.after(() => {
  db.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('legacy external_sources rows survive the idempotency_key migration', () => {
  const columns = db.prepare('PRAGMA table_info(external_sources)').all().map(column => column.name);
  assert.ok(columns.includes('idempotency_key'), 'idempotency_key column must be ensured');

  const row = db.prepare('SELECT * FROM external_sources WHERE name = ?').get('存量上游');
  assert.equal(row.source_url, 'rtmp://legacy.example/live/a');
  assert.equal(row.protocol, 'rtmp');
  assert.equal(row.pull_mode, 'pull');
  assert.equal(row.status, 'active');
  assert.equal(row.idempotency_key, null);

  const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='external_sources'").all().map(index => index.name);
  assert.ok(indexes.includes('idx_external_sources_idempotency'), 'unique partial index must exist');

  // The unique index must actually enforce one row per key while allowing
  // any number of legacy NULL-key rows.
  db.prepare('INSERT INTO external_sources (name, source_url, idempotency_key) VALUES (?, ?, ?)')
    .run('幂等源', 'rtmp://x.example/live/k', 'key-a');
  assert.throws(() => {
    db.prepare('INSERT INTO external_sources (name, source_url, idempotency_key) VALUES (?, ?, ?)')
      .run('重复键', 'rtmp://y.example/live/k2', 'key-a');
  }, /UNIQUE constraint failed/);
  db.prepare('INSERT INTO external_sources (name, source_url) VALUES (?, ?)')
    .run('另一个无键源', 'rtmp://z.example/live/k3');
});
