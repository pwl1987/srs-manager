const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'srs-manager-ingest-'));
process.env.DATA_DIR = dataDir;
const db = require('../database');
const ingest = require('../services/ingest-credential-service');
const internalMedia = require('../services/internal-media-service');

test('IN-PUSH ingest credential is one-time secret, enforced after opt-in, and preserves internal media bypass', (t) => {
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const streamId = Number(db.prepare("INSERT INTO streams(name,protocol,status) VALUES('news-main','rtmp','offline')").run().lastInsertRowid);
  const legacy = ingest.authorizePublish({ stream: 'news-main', client_id: 'legacy-1', param: '' });
  assert.equal(legacy.allowed, true);
  assert.equal(legacy.reason, 'legacy_open_ingest');

  const created = ingest.createCredential(streamId, { label: '主编码器', created_by: 'admin' });
  assert.ok(created.token);
  assert.ok(created.publish_url.includes('ingest_token='));
  assert.ok(created.stream_key.startsWith('news-main?ingest_token='));
  assert.equal(Object.hasOwn(created.credential, 'token_hash'), false);
  assert.equal(Object.hasOwn(ingest.listCredentials(streamId)[0], 'token_hash'), false);
  assert.equal(db.prepare('SELECT token_hash FROM ingest_credentials WHERE id=?').get(created.credential.id).token_hash.includes(created.token), false);

  assert.equal(ingest.authorizePublish({ stream: 'news-main', param: '' }).allowed, false);
  assert.equal(ingest.authorizePublish({ stream: 'news-main', param: '?ingest_token=wrong' }).allowed, false);
  const allowed = ingest.authorizePublish({ stream: 'news-main', client_id: 'pub-1', ip: '10.0.0.2', param: `?ingest_token=${created.token}` });
  assert.equal(allowed.allowed, true);
  assert.equal(allowed.credential_id, created.credential.id);
  ingest.recordPublishSession({ client_id: 'pub-1', ip: '10.0.0.2' }, allowed);
  assert.equal(ingest.activeSessionForPublisher(streamId, 'pub-1').credential_label, '主编码器');

  const internalToken = internalMedia.getInternalMediaToken();
  const internal = ingest.authorizePublish({ stream: 'news-main', client_id: 'internal-1', param: `?internal_media_token=${internalToken}` });
  assert.equal(internal.allowed, true);
  assert.equal(internal.session_kind, 'internal');

  ingest.revokeCredential(streamId, created.credential.id);
  assert.equal(ingest.authorizePublish({ stream: 'news-main', param: `?ingest_token=${created.token}` }).allowed, false, 'revoking the final credential must not reopen legacy ingest');
  assert.ok(ingest.activeSessionForPublisher(streamId, 'pub-1'), 'revocation must not pretend to disconnect an already-active publisher');
  ingest.recordUnpublishSession({ client_id: 'pub-1' });
  assert.equal(ingest.activeSessionForPublisher(streamId, 'pub-1'), null);
});
