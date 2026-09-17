const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'srs-manager-transcode-migration-'));
process.env.DATA_DIR = dataDir;
const file = path.join(dataDir, 'srs-manager.db');

const legacy = new Database(file);
legacy.exec(`
  CREATE TABLE streams (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    protocol TEXT DEFAULT 'rtmp',
    transcode_template_id INTEGER
  );
  CREATE TABLE transcode_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    vcodec TEXT,
    acodec TEXT,
    video_config TEXT,
    audio_config TEXT,
    output_format TEXT DEFAULT 'rtmp',
    enabled INTEGER DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
`);const templateId = Number(legacy.prepare(`INSERT INTO transcode_templates
  (name, vcodec, acodec, video_config, audio_config, enabled)
  VALUES ('Legacy Main', 'h264', 'aac', '{"width":1920,"height":1080}', '{"bitrate":192}', 1)`)
  .run().lastInsertRowid);
const streamId = Number(legacy.prepare("INSERT INTO streams (name, protocol, transcode_template_id) VALUES ('legacy-news', 'rtmp', ?)")
  .run(templateId).lastInsertRowid);
legacy.close();

const db = require('../database');

test('legacy single transcode template migrates into a stopped multi-binding without auto-start', (t) => {
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const columns = new Set(db.prepare('PRAGMA table_info(transcode_templates)').all().map(row => row.name));
  assert.equal(columns.has('updated_at'), true);

  const binding = db.prepare('SELECT * FROM stream_transcode_bindings WHERE stream_id = ?').get(streamId);
  assert.ok(binding);
  assert.equal(binding.template_id, templateId);
  assert.equal(binding.role, 'main');
  assert.equal(binding.output_suffix, 'main');
  assert.equal(binding.desired_state, 'STOPPED');
  assert.equal(binding.runtime_state, 'STOPPED');

  const count = db.prepare('SELECT COUNT(*) AS count FROM stream_transcode_bindings WHERE stream_id = ?').get(streamId).count;
  assert.equal(count, 1, 'migration must stay idempotent');
});