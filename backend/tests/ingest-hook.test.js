const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'srs-manager-ingest-hook-'));
process.env.DATA_DIR = dataDir;
const db = require('../database');
const ingest = require('../services/ingest-credential-service');
const hooks = require('../services/hooks-handler');

test('on_publish only marks a credential-enforced stream online after authorization', (t) => {
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const streamId = Number(db.prepare("INSERT INTO streams(name,protocol,status) VALUES('secure-ingest','rtmp','offline')").run().lastInsertRowid);
  const created = ingest.createCredential(streamId, { label: 'Encoder A' });
  const denied = hooks.handleOnPublish({ stream: 'secure-ingest', client_id: 'bad', ip: '10.0.0.3', param: '?ingest_token=wrong' });
  assert.equal(denied.allowed, false);
  assert.equal(db.prepare('SELECT status FROM streams WHERE id=?').get(streamId).status, 'offline');
  const allowed = hooks.handleOnPublish({ stream: 'secure-ingest', client_id: 'good', ip: '10.0.0.4', param: `?ingest_token=${created.token}` });
  assert.equal(allowed.allowed, true);
  assert.equal(db.prepare('SELECT status FROM streams WHERE id=?').get(streamId).status, 'online');
  assert.equal(ingest.activeSessionForPublisher(streamId, 'good').credential_id, created.credential.id);
  hooks.handleOnUnpublish({ stream: 'secure-ingest', client_id: 'good' });
  assert.equal(ingest.activeSessionForPublisher(streamId, 'good'), null);
});
