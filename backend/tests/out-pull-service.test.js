const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'srs-manager-out-pull-'));
process.env.DATA_DIR = dataDir;
const db = require('../database');
const outPullService = require('../services/out-pull-service');
const internalMediaService = require('../services/internal-media-service');

test('OUT-PULL policy enforces admission while grants stay hashed and revocation does not hide semantics', (t) => {
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const stream = db.prepare("INSERT INTO streams (name, protocol, status) VALUES ('pull-access', 'rtmp', 'online')").run();
  const streamId = Number(stream.lastInsertRowid);

  assert.deepEqual(outPullService.getPolicy(streamId), {
    stream_id: streamId,
    endpoint_enabled: true,
    accepting_new_sessions: true,
    require_grant: false,
    v3_metadata: null,
    updated_at: null
  });
  assert.equal(outPullService.authorizePlay({ stream: 'pull-access' }).allowed, true);

  outPullService.updatePolicy(streamId, { require_grant: true });
  assert.equal(outPullService.authorizePlay({ stream: 'pull-access' }).allowed, false);

  const grant = outPullService.createGrant(streamId, {
    label: 'partner-a',
    expires_at: new Date(Date.now() + 3600000).toISOString(),
    created_by: 'tester'
  });
  assert.ok(grant.token);
  const stored = db.prepare('SELECT token_hash FROM access_grants WHERE id = ?').get(grant.id);
  assert.notEqual(stored.token_hash, grant.token);
  assert.equal(stored.token_hash, outPullService.hashToken(grant.token));

  const allowed = outPullService.authorizePlay({ stream: 'pull-access', client_id: 'c1', ip: '1.2.3.4', param: `?access_token=${grant.token}` });
  assert.equal(allowed.allowed, true);
  assert.equal(allowed.grant_id, grant.id);
  outPullService.recordPlaySession({ client_id: 'c1', ip: '1.2.3.4' }, allowed);
  assert.equal(outPullService.activeSessions(streamId).length, 1);

  assert.equal(outPullService.revokeGrant(streamId, grant.id).status, 'REVOKED');
  assert.equal(outPullService.authorizePlay({ stream: 'pull-access', param: `?access_token=${grant.token}` }).allowed, false);
  assert.equal(outPullService.activeSessions(streamId).length, 1, 'revoking access must not pretend the current session was disconnected');

  const internalToken = internalMediaService.getInternalMediaToken();
  const internal = outPullService.authorizePlay({ stream: 'pull-access', param: `?internal_media_token=${internalToken}` });
  assert.equal(internal.allowed, true);
  assert.equal(internal.reason, 'internal_media');

  outPullService.updatePolicy(streamId, { endpoint_enabled: false, accepting_new_sessions: false });
  assert.equal(outPullService.authorizePlay({ stream: 'pull-access' }).reason, 'endpoint_disabled');
  assert.equal(outPullService.authorizePlay({ stream: 'unmanaged-stream' }).allowed, true);

  outPullService.recordStopSession({ client_id: 'c1' });
  assert.equal(outPullService.activeSessions(streamId).length, 0);
});
