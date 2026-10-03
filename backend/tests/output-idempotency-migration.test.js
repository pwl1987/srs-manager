const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

// PHASE-09-FIX-04: a database created before output_idempotency existed must
// gain the table + unique (room_id, idempotency_key) index on upgrade while
// keeping every existing row intact. PHASE-09-FIX-05/06 additionally gain
// SERVE revision tracking — and the migration evidence is a TRUE pre-upgrade
// database: before requiring ../database the fixture creates the upstream
// (987efeb-era) out_pull_policies WITHOUT generation/epoch, plus a FIX-04-era
// output_idempotency WITHOUT result_revision/result_epoch, inserts REAL
// pre-upgrade rows into both, and only then loads the current schema. The
// assertions below therefore prove the actual ALTER TABLE outcomes, not a
// post-migration reconstruction. Own process (node --test), so seeding a
// legacy database before requiring ../database is safe. The legacy seed runs
// through prepared statements only — no dynamic SQL anywhere.

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'srs-manager-output-idem-mig-'));
process.env.DATA_DIR = dataDir;
process.env.SRS_API_URL = 'http://127.0.0.1:1985/api/v1';

const legacyConn = new Database(path.join(dataDir, 'srs-manager.db'));
legacyConn.prepare('CREATE TABLE streams (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, protocol TEXT DEFAULT \'rtmp\', created_at TEXT DEFAULT CURRENT_TIMESTAMP)').run();
legacyConn.prepare('CREATE TABLE forward_tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, stream_id INTEGER NOT NULL, target_type TEXT, target_url TEXT NOT NULL, enabled INTEGER DEFAULT 0, status TEXT DEFAULT \'idle\', created_at TEXT DEFAULT CURRENT_TIMESTAMP)').run();
legacyConn.prepare('INSERT INTO streams (name, protocol) VALUES (?, ?)').run('存量直播间', 'rtmp');
legacyConn.prepare('INSERT INTO forward_tasks (stream_id, target_type, target_url) VALUES (?, ?, ?)').run(1, 'CUSTOM', 'rtmp://legacy.example/live/a');
// Pre-FIX-05 policy table: the upstream shape with NO generation/epoch.
legacyConn.prepare(`CREATE TABLE out_pull_policies (
  stream_id INTEGER PRIMARY KEY,
  endpoint_enabled INTEGER NOT NULL DEFAULT 1,
  accepting_new_sessions INTEGER NOT NULL DEFAULT 1,
  require_grant INTEGER NOT NULL DEFAULT 0,
  v3_metadata_json TEXT,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
)`).run();
// A FIX-04-era candidate database already had output_idempotency WITHOUT the
// revision columns (result_revision arrives in FIX-05, result_epoch in 06).
legacyConn.prepare(`CREATE TABLE output_idempotency (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id INTEGER NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  output_type TEXT NOT NULL,
  subject_id INTEGER,
  output_id TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
)`).run();
// REAL pre-upgrade rows: one live SERVE policy and one SERVE mapping recorded
// by FIX-04-era code (its fingerprint is opaque; any 64-hex value is what an
// upgraded database would actually contain).
legacyConn.prepare(`INSERT INTO out_pull_policies (stream_id, endpoint_enabled, accepting_new_sessions, require_grant, v3_metadata_json, updated_at)
  VALUES (?, 1, 1, 0, ?, CURRENT_TIMESTAMP)`).run(1, JSON.stringify({ scene: 'PARTNER_PULL' }));
legacyConn.prepare(`INSERT INTO output_idempotency (room_id, idempotency_key, request_fingerprint, output_type, subject_id, output_id)
  VALUES (?, ?, ?, ?, ?, ?)`).run(1, 'pre05-serve-key', 'f'.repeat(64), 'serve', 1, 'output:serve:1');
legacyConn.close();

const db = require('../database');

const SERVE_PAYLOAD = {
  mode: 'SERVE', name: '伙伴拉流', scene: 'PARTNER_PULL',
  transports: ['rtmp', 'http-flv'], consumer: { label: '伙伴拉流' }
};

test.after(() => {
  db.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('a legacy database gains output_idempotency with the room+key unique constraint', () => {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'output_idempotency'").all();
  assert.equal(tables.length, 1);
  const columns = db.prepare('PRAGMA table_info(output_idempotency)').all().map(column => column.name);
  for (const expected of ['id', 'room_id', 'idempotency_key', 'request_fingerprint', 'output_type', 'subject_id', 'output_id', 'result_revision', 'result_epoch', 'created_at']) {
    assert.ok(columns.includes(expected), `column ${expected} missing`);
  }
  const indexes = db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'output_idempotency'").all();
  const uniqueIndex = indexes.find(index => /UNIQUE/i.test(index.sql || '') && /room_id/.test(index.sql) && /idempotency_key/.test(index.sql));
  assert.ok(uniqueIndex, 'unique (room_id, idempotency_key) index exists');
});

test('legacy rows survive and the key constraint binds per room', () => {
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM streams').get().count, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM forward_tasks').get().count, 1);

  db.prepare('INSERT INTO output_idempotency (room_id, idempotency_key, request_fingerprint, output_type, subject_id, output_id) VALUES (?, ?, ?, ?, ?, ?)')
    .run(1, 'mig-key', 'a'.repeat(64), 'push', 1, 'output:push:1');
  assert.throws(() => {
    db.prepare('INSERT INTO output_idempotency (room_id, idempotency_key, request_fingerprint, output_type, subject_id, output_id) VALUES (?, ?, ?, ?, ?, ?)')
      .run(1, 'mig-key', 'b'.repeat(64), 'push', 1, 'output:push:1');
  }, 'the same key cannot bind twice inside one room');
  db.prepare('INSERT INTO output_idempotency (room_id, idempotency_key, request_fingerprint, output_type, subject_id, output_id) VALUES (?, ?, ?, ?, ?, ?)')
    .run(2, 'mig-key', 'a'.repeat(64), 'push', 1, 'output:push:1');
});

test('a true pre-FIX-05 upgrade gains the persistent SERVE revision authority (real ALTER evidence)', () => {
  // The pre-upgrade policy row, created before generation/epoch existed,
  // migrates to epoch 1 / generation 1 with both columns NOT NULL.
  const policyColumns = db.prepare('PRAGMA table_info(out_pull_policies)').all();
  for (const name of ['generation', 'epoch']) {
    const column = policyColumns.find(entry => entry.name === name);
    assert.ok(column, `${name} column exists after upgrade`);
    assert.equal(column.notnull, 1, `${name} is NOT NULL`);
  }
  const migratedPolicy = db.prepare('SELECT * FROM out_pull_policies WHERE stream_id = 1').get();
  assert.ok(migratedPolicy, 'the pre-upgrade policy row survived');
  assert.equal(migratedPolicy.epoch, 1, 'legacy policy row lands on epoch 1');
  assert.equal(migratedPolicy.generation, 1, 'legacy policy row lands on generation 1');

  // The pre-upgrade SERVE mapping keeps NULL revision columns (fail-closed).
  const legacyMapping = db.prepare('SELECT * FROM output_idempotency WHERE idempotency_key = ?').get('pre05-serve-key');
  assert.ok(legacyMapping, 'the pre-upgrade mapping row survived');
  assert.equal(legacyMapping.result_revision, null, 'legacy mapping has no provable revision');
  assert.equal(legacyMapping.result_epoch, null, 'legacy mapping has no provable epoch');

  // The persistent authority table exists and holds nothing until the first
  // post-upgrade write.
  const authorityTable = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'serve_policy_revisions'").all();
  assert.equal(authorityTable.length, 1, 'serve_policy_revisions exists after upgrade');
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM serve_policy_revisions').get().count, 0);

  // First post-upgrade write on the legacy row: the existing instance keeps
  // epoch 1, and the new generation must exceed the legacy row's migrated
  // generation (the provable history bound).
  const outputService = require('../services/v3-output-service');
  outputService.configureServeOutput(1, SERVE_PAYLOAD, { idempotency_key: 'post06-key-1' });
  let row = db.prepare('SELECT epoch, generation FROM out_pull_policies WHERE stream_id = 1').get();
  assert.equal(row.epoch, 1, 'a write on the existing instance keeps its epoch');
  assert.equal(row.generation, 2, 'generation exceeds the legacy row\'s migrated value');
  let authority = db.prepare('SELECT epoch, generation FROM serve_policy_revisions WHERE stream_id = 1').get();
  assert.deepEqual(authority, row, 'the persistent authority matches the live row');

  // delete → recreate: a NEW epoch with a strictly greater generation; the
  // authority survives the policy-row deletion.
  db.prepare('DELETE FROM out_pull_policies WHERE stream_id = 1').run();
  assert.ok(db.prepare('SELECT epoch, generation FROM serve_policy_revisions WHERE stream_id = 1').get(),
    'deleting the policy row never deletes the authority');
  outputService.configureServeOutput(1, SERVE_PAYLOAD, { idempotency_key: 'post06-key-2' });
  row = db.prepare('SELECT epoch, generation FROM out_pull_policies WHERE stream_id = 1').get();
  assert.equal(row.epoch, 2, 'recreate after absence is a new instance');
  assert.equal(row.generation, 3, 'generation keeps climbing across the deletion');
  authority = db.prepare('SELECT epoch, generation FROM serve_policy_revisions WHERE stream_id = 1').get();
  assert.deepEqual(authority, row);
});

test('a SERVE mapping without a provable revision replays fail-closed (behavioral complement)', () => {
  // Structural upgrade evidence is the test above. This exercises the NULL
  // revision code paths directly: a mapping that cannot prove its instance
  // never replays by guess — for both the fully-legacy shape (both NULL) and
  // the FIX-05-era shape (revision present, epoch NULL).
  const outputService = require('../services/v3-output-service');
  outputService.configureServeOutput(1, SERVE_PAYLOAD, { idempotency_key: 'null-revision-key' });
  db.prepare('UPDATE output_idempotency SET result_revision = NULL, result_epoch = NULL WHERE idempotency_key = ?').run('null-revision-key');
  assert.throws(
    () => outputService.configureServeOutput(1, SERVE_PAYLOAD, { idempotency_key: 'null-revision-key' }),
    error => error.idempotencySuperseded === true,
    'an unproven revision fails closed, never replays by guess'
  );

  outputService.configureServeOutput(1, SERVE_PAYLOAD, { idempotency_key: 'fix05-shape-key' });
  db.prepare('UPDATE output_idempotency SET result_epoch = NULL WHERE idempotency_key = ?').run('fix05-shape-key');
  assert.throws(
    () => outputService.configureServeOutput(1, SERVE_PAYLOAD, { idempotency_key: 'fix05-shape-key' }),
    error => error.idempotencySuperseded === true,
    'a revision without an epoch (FIX-05-era shape) fails closed identically'
  );
});
