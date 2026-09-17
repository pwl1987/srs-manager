const crypto = require('crypto');
const db = require('../database');
const internalMediaService = require('./internal-media-service');
const { buildUrls } = require('./stream-urls');

function hashToken(token) { return crypto.createHash('sha256').update(String(token || '')).digest('hex'); }
function queryParams(value) { return new URLSearchParams(String(value || '').replace(/^\?/, '')); }
function streamById(id) { return db.prepare('SELECT id, name FROM streams WHERE id = ?').get(Number(id)) || null; }
function streamByName(name) { return db.prepare('SELECT id, name FROM streams WHERE name = ?').get(String(name || '')) || null; }

function safeCredential(row) {
  if (!row) return null;
  return { id: row.id, stream_id: row.stream_id, label: row.label, token_hint: row.token_hint, status: row.status, created_by: row.created_by, created_at: row.created_at, last_used_at: row.last_used_at, revoked_at: row.revoked_at };
}

function listCredentials(streamId) {
  return db.prepare('SELECT * FROM ingest_credentials WHERE stream_id = ? ORDER BY created_at ASC, id ASC').all(Number(streamId)).map(safeCredential);
}

function publishDescriptor(stream, token) {
  const pushUrl = buildUrls(stream.name).push_url;
  const parsed = new URL(pushUrl);
  const parts = parsed.pathname.split('/').filter(Boolean);
  parts.pop();
  parsed.pathname = `/${parts.join('/')}`;
  parsed.search = '';
  const streamKey = `${stream.name}?ingest_token=${encodeURIComponent(token)}`;
  return { server_url: parsed.toString().replace(/\/$/, ''), stream_key: streamKey, publish_url: `${pushUrl}?ingest_token=${encodeURIComponent(token)}` };
}

function createCredential(streamId, { label, created_by = null } = {}) {
  const stream = streamById(streamId);
  if (!stream) throw new Error('Stream not found');
  const cleanLabel = String(label || '').trim();
  if (!cleanLabel) throw new Error('Ingest credential label is required');
  const token = crypto.randomBytes(24).toString('base64url');
  const result = db.prepare(`INSERT INTO ingest_credentials (stream_id, label, token_hash, token_hint, created_by) VALUES (?, ?, ?, ?, ?)`)
    .run(stream.id, cleanLabel, hashToken(token), token.slice(-6), created_by || null);
  const credential = safeCredential(db.prepare('SELECT * FROM ingest_credentials WHERE id = ?').get(Number(result.lastInsertRowid)));
  return { credential, token, ...publishDescriptor(stream, token) };
}

function revokeCredential(streamId, credentialId) {
  const row = db.prepare('SELECT * FROM ingest_credentials WHERE id = ? AND stream_id = ?').get(Number(credentialId), Number(streamId));
  if (!row) return null;
  if (row.status !== 'REVOKED') db.prepare("UPDATE ingest_credentials SET status='REVOKED', revoked_at=CURRENT_TIMESTAMP WHERE id=?").run(row.id);
  return safeCredential(db.prepare('SELECT * FROM ingest_credentials WHERE id = ?').get(row.id));
}

function authorizePublish(data = {}) {
  const stream = streamByName(data.stream || data.stream_name || data.params?.stream);
  if (!stream) return { allowed: true, stream_id: null, credential_id: null, session_kind: 'unmanaged', reason: 'unmanaged_stream' };
  const params = queryParams(data.param);
  if (internalMediaService.matchesInternalMediaToken(params.get('internal_media_token'))) {
    return { allowed: true, stream_id: stream.id, credential_id: null, session_kind: 'internal', reason: 'internal_media' };
  }
  const credentialCount = db.prepare("SELECT COUNT(*) AS n FROM ingest_credentials WHERE stream_id = ?").get(stream.id).n;
  if (!credentialCount) return { allowed: true, stream_id: stream.id, credential_id: null, session_kind: 'legacy', reason: 'legacy_open_ingest' };
  const token = params.get('ingest_token');
  if (!token) return { allowed: false, stream_id: stream.id, credential_id: null, session_kind: 'external', reason: 'ingest_credential_required' };
  const credential = db.prepare("SELECT * FROM ingest_credentials WHERE stream_id = ? AND token_hash = ? AND status = 'ACTIVE' LIMIT 1").get(stream.id, hashToken(token));
  if (!credential) return { allowed: false, stream_id: stream.id, credential_id: null, session_kind: 'external', reason: 'invalid_ingest_credential' };
  return { allowed: true, stream_id: stream.id, credential_id: credential.id, session_kind: 'external', reason: 'ingest_credential' };
}

function recordPublishSession(data, authorization) {
  if (!authorization?.stream_id || !data?.client_id) return null;
  db.prepare(`INSERT INTO ingest_sessions (client_id, stream_id, credential_id, session_kind, ip, started_at, stopped_at)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, NULL)
    ON CONFLICT(client_id) DO UPDATE SET stream_id=excluded.stream_id, credential_id=excluded.credential_id, session_kind=excluded.session_kind, ip=excluded.ip, started_at=CURRENT_TIMESTAMP, stopped_at=NULL`)
    .run(String(data.client_id), authorization.stream_id, authorization.credential_id || null, authorization.session_kind || 'external', data.ip || null);
  if (authorization.credential_id) db.prepare('UPDATE ingest_credentials SET last_used_at=CURRENT_TIMESTAMP WHERE id=?').run(authorization.credential_id);
  return activeSessionForPublisher(authorization.stream_id, data.client_id);
}

function recordUnpublishSession(data) {
  if (!data?.client_id) return null;
  const row = db.prepare('SELECT * FROM ingest_sessions WHERE client_id=? AND stopped_at IS NULL').get(String(data.client_id)) || null;
  db.prepare('UPDATE ingest_sessions SET stopped_at=CURRENT_TIMESTAMP WHERE client_id=? AND stopped_at IS NULL').run(String(data.client_id));
  return row;
}

function activeSessionForPublisher(streamId, clientId) {
  if (!clientId) return null;
  return db.prepare(`SELECT s.client_id, s.stream_id, s.credential_id, s.session_kind, s.ip, s.started_at,
      c.label AS credential_label, c.status AS credential_status, c.token_hint
    FROM ingest_sessions s LEFT JOIN ingest_credentials c ON c.id=s.credential_id
    WHERE s.stream_id=? AND s.client_id=? AND s.stopped_at IS NULL`).get(Number(streamId), String(clientId)) || null;
}

module.exports = { hashToken, listCredentials, createCredential, revokeCredential, authorizePublish, recordPublishSession, recordUnpublishSession, activeSessionForPublisher };
