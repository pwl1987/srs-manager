const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

// PHASE-09 migration gate: a database created by the pre-PHASE-09 schema must
// gain remark/business_unit via ensureColumn while keeping every existing row
// byte-for-byte intact. This file runs in its own process (node --test), so
// seeding the DB file before requiring ../database is safe.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'srs-manager-stream-meta-mig-'));
process.env.DATA_DIR = dataDir;
process.env.SRS_API_URL = 'http://127.0.0.1:1985/api/v1';

const legacyConn = new Database(path.join(dataDir, 'srs-manager.db'));
legacyConn.exec(`
  CREATE TABLE streams (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    protocol TEXT DEFAULT 'rtmp',
    push_url TEXT,
    pull_url TEXT,
    status TEXT DEFAULT 'offline',
    last_online_at TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    bitrate INTEGER DEFAULT 0,
    viewers INTEGER DEFAULT 0,
    updated_at TEXT
  );
  INSERT INTO streams (name, protocol, status, updated_at) VALUES ('存量直播间', 'rtmp', 'online', '2026-09-01 00:00:00');
`);
legacyConn.close();

const db = require('../database');

test.after(() => {
  db.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('upgrading an old streams table adds identity columns without touching data', () => {
  const columns = db.prepare('PRAGMA table_info(streams)').all().map(column => column.name);
  assert.equal(columns.includes('remark'), true);
  assert.equal(columns.includes('business_unit'), true);

  const row = db.prepare('SELECT * FROM streams WHERE name = ?').get('存量直播间');
  assert.equal(row.protocol, 'rtmp');
  assert.equal(row.status, 'online');
  assert.equal(row.updated_at, '2026-09-01 00:00:00');
  assert.equal(row.remark, null);
  assert.equal(row.business_unit, null);
});
