const crypto = require('crypto');
const db = require('../database');
const internalMediaService = require('./internal-media-service');

function getStream(streamId) {
  return db.prepare('SELECT id, name FROM streams WHERE id = ?').get(Number(streamId)) || null;
}

function getStreamByName(name) {
  return db.prepare('SELECT id, name FROM streams WHERE name = ?').get(String(name || '')) || null;
}

function getPolicy(streamId) {
  const stream = getStream(streamId);
  if (!stream) return null;
  const row = db.prepare('SELECT * FROM out_pull_policies WHERE stream_id = ?').get(stream.id);
  return {
    stream_id: stream.id,
    endpoint_enabled: row ? Boolean(row.endpoint_enabled) : true,
    accepting_new_sessions: row ? Boolean(row.accepting_new_sessions) : true,
    require_grant: row ? Boolean(row.require_grant) : false,
    updated_at: row?.updated_at || null
  };
}

function updatePolicy(streamId, updates = {}) {
  const stream = getStream(streamId);
  if (!stream) return null;
  const current = getPolicy(stream.id);
  const value = {
    endpoint_enabled: updates.endpoint_enabled === undefined ? current.endpoint_enabled : Boolean(updates.endpoint_enabled),
    accepting_new_sessions: updates.accepting_new_sessions === undefined ? current.accepting_new_sessions : Boolean(updates.accepting_new_sessions),
    require_grant: updates.require_grant === undefined ? current.require_grant : Boolean(updates.require_grant)
  };
  db.prepare(`
    INSERT INTO out_pull_policies (stream_id, endpoint_enabled, accepting_new_sessions, require_grant, updated_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(stream_id) DO UPDATE SET
      endpoint_enabled = excluded.endpoint_enabled,
      accepting_new_sessions = excluded.accepting_new_sessions,
      require_grant = excluded.require_grant,
      updated_at = CURRENT_TIMESTAMP
  `).run(stream.id, value.endpoint_enabled ? 1 : 0, value.accepting_new_sessions ? 1 : 0, value.require_grant ? 1 : 0);
  return getPolicy(stream.id);
}
function hashToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}


function effectiveGrant(row) {
  if (!row) return null;
  const expired = Number.isFinite(Date.parse(row.expires_at)) && Date.parse(row.expires_at) <= Date.now();
  const notStarted = row.valid_from && Number.isFinite(Date.parse(row.valid_from)) && Date.parse(row.valid_from) > Date.now();
  return {
    id: row.id,
    stream_id: row.stream_id,
    label: row.label,
    token_hint: row.token_hint,
    status: row.status === 'ACTIVE' && expired ? 'EXPIRED' : row.status,
    valid_from: row.valid_from,
    expires_at: row.expires_at,
    usable_now: row.status === 'ACTIVE' && !expired && !notStarted,
    created_by: row.created_by,
    created_at: row.created_at,
    revoked_at: row.revoked_at
  };
}

function listGrants(streamId) {
  return db.prepare('SELECT * FROM access_grants WHERE stream_id = ? ORDER BY created_at DESC')
    .all(Number(streamId)).map(effectiveGrant);
}

function createGrant(streamId, { label, valid_from = null, expires_at, created_by = null } = {}) {
  const stream = getStream(streamId);
  if (!stream) throw new Error('Stream not found');
  if (!label || !String(label).trim()) throw new Error('Grant label is required');
  const expiryMs = Date.parse(expires_at);
  if (!Number.isFinite(expiryMs) || expiryMs <= Date.now()) throw new Error('Grant expiration must be in the future');
  if (valid_from && !Number.isFinite(Date.parse(valid_from))) throw new Error('Invalid grant start time');

  const token = crypto.randomBytes(24).toString('base64url');
  const tokenHash = hashToken(token);
  const tokenHint = token.slice(-6);
  const result = db.prepare(`
    INSERT INTO access_grants (stream_id, label, token_hash, token_hint, valid_from, expires_at, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(stream.id, String(label).trim(), tokenHash, tokenHint, valid_from || null, new Date(expiryMs).toISOString(), created_by || null);
  const grant = effectiveGrant(db.prepare('SELECT * FROM access_grants WHERE id = ?').get(Number(result.lastInsertRowid)));
  return { ...grant, token };
}

function revokeGrant(streamId, grantId) {
  const grant = db.prepare('SELECT * FROM access_grants WHERE id = ? AND stream_id = ?').get(Number(grantId), Number(streamId));
  if (!grant) return null;
  db.prepare(`UPDATE access_grants SET status = 'REVOKED', revoked_at = CURRENT_TIMESTAMP WHERE id = ?`).run(grant.id);
  return effectiveGrant(db.prepare('SELECT * FROM access_grants WHERE id = ?').get(grant.id));
}
function queryParams(value) {
  const raw = String(value || '').replace(/^\?/, '');
  return new URLSearchParams(raw);
}

function isInternalMediaRequest(data) {
  const candidate = queryParams(data?.param).get('internal_media_token');
  return internalMediaService.matchesInternalMediaToken(candidate);
}

function validGrantFor(streamId, token) {
  if (!token) return null;
  const row = db.prepare(`
    SELECT * FROM access_grants
    WHERE stream_id = ? AND token_hash = ? AND status = 'ACTIVE'
    LIMIT 1
  `).get(Number(streamId), hashToken(token));
  if (!row) return null;
  const grant = effectiveGrant(row);
  return grant?.usable_now ? grant : null;
}

function authorizePlay(data = {}) {
  const streamName = data.stream || data.stream_name || data.params?.stream;
  const stream = getStreamByName(streamName);
  if (!stream) return { allowed: true, stream_id: null, grant_id: null, reason: 'unmanaged_stream' };

  if (isInternalMediaRequest(data)) {
    return { allowed: true, stream_id: stream.id, grant_id: null, reason: 'internal_media' };
  }

  const policy = getPolicy(stream.id);
  if (!policy.endpoint_enabled) return { allowed: false, stream_id: stream.id, grant_id: null, reason: 'endpoint_disabled' };
  if (!policy.accepting_new_sessions) return { allowed: false, stream_id: stream.id, grant_id: null, reason: 'new_sessions_paused' };
  if (!policy.require_grant) return { allowed: true, stream_id: stream.id, grant_id: null, reason: 'open_access' };

  const token = queryParams(data.param).get('access_token');
  const grant = validGrantFor(stream.id, token);
  if (!grant) return { allowed: false, stream_id: stream.id, grant_id: null, reason: 'invalid_or_expired_grant' };
  return { allowed: true, stream_id: stream.id, grant_id: grant.id, reason: 'grant' };
}
function recordPlaySession(data, authorization) {
  if (!authorization?.stream_id || !data?.client_id) return;
  db.prepare(`
    INSERT INTO out_pull_sessions (client_id, stream_id, grant_id, ip, started_at, stopped_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, NULL)
    ON CONFLICT(client_id) DO UPDATE SET
      stream_id = excluded.stream_id,
      grant_id = excluded.grant_id,
      ip = excluded.ip,
      started_at = CURRENT_TIMESTAMP,
      stopped_at = NULL
  `).run(String(data.client_id), authorization.stream_id, authorization.grant_id || null, data.ip || null);
}

function recordStopSession(data) {
  if (!data?.client_id) return;
  db.prepare('UPDATE out_pull_sessions SET stopped_at = CURRENT_TIMESTAMP WHERE client_id = ? AND stopped_at IS NULL')
    .run(String(data.client_id));
}

function activeSessions(streamId) {
  return db.prepare(`
    SELECT client_id, grant_id, ip, started_at
    FROM out_pull_sessions
    WHERE stream_id = ? AND stopped_at IS NULL
    ORDER BY started_at DESC
  `).all(Number(streamId));
}

function getOverview(streamId) {
  const policy = getPolicy(streamId);
  if (!policy) return null;
  return {
    policy,
    grants: listGrants(streamId),
    active_sessions: activeSessions(streamId)
  };
}

module.exports = {
  getPolicy,
  updatePolicy,
  listGrants,
  createGrant,
  revokeGrant,
  authorizePlay,
  recordPlaySession,
  recordStopSession,
  activeSessions,
  getOverview,
  hashToken,
  isInternalMediaRequest
};
