const { randomUUID } = require('crypto');
const jwt = require('jsonwebtoken');
const config = require('../config');

const PURPOSE = 'operator_preview';
const SOURCE_PURPOSE = 'operator_source_preview';
const ISSUER = 'srs-manager';
const AUDIENCE = 'srs-operator-preview';
const DEFAULT_TTL_SECONDS = 10 * 60;

function ttlSeconds() {
  const value = Number(process.env.PREVIEW_TOKEN_TTL || DEFAULT_TTL_SECONDS);
  if (!Number.isFinite(value)) return DEFAULT_TTL_SECONDS;
  return Math.max(60, Math.min(3600, Math.floor(value)));
}

function issuePreviewToken(stream) {
  if (!stream?.id || !stream?.name) throw new Error('Stream is required');
  const ttl = ttlSeconds();
  const token = jwt.sign({
    purpose: PURPOSE,
    stream_id: Number(stream.id),
    stream_name: String(stream.name)
  }, config.jwtSecret, {
    expiresIn: ttl,
    issuer: ISSUER,
    audience: AUDIENCE,
    subject: String(stream.id),
    jwtid: randomUUID()
  });
  const hls = `/api/preview/${encodeURIComponent(stream.id)}/index.m3u8?preview_token=${encodeURIComponent(token)}`;
  const httpFlv = `/api/preview/${encodeURIComponent(stream.id)}/live.flv?preview_token=${encodeURIComponent(token)}`;
  return {
    token,
    expires_at: new Date(Date.now() + ttl * 1000).toISOString(),
    ttl_seconds: ttl,
    preferred_transport: 'http-flv',
    preview_url: hls,
    preview_urls: { http_flv: httpFlv, hls }
  };
}


function issueSourcePreviewToken(stream, sourceId) {
  if (!stream?.id || !stream?.name || !sourceId) throw new Error('Stream and source are required');
  const ttl = ttlSeconds();
  const token = jwt.sign({ purpose: SOURCE_PURPOSE, stream_id: Number(stream.id), stream_name: String(stream.name), source_id: String(sourceId) }, config.jwtSecret, {
    expiresIn: ttl, issuer: ISSUER, audience: AUDIENCE, subject: String(stream.id), jwtid: randomUUID()
  });
  return {
    token, expires_at: new Date(Date.now() + ttl * 1000).toISOString(), ttl_seconds: ttl,
    preferred_transport: 'http-flv', source_id: String(sourceId),
    preview_url: `/api/preview/${encodeURIComponent(stream.id)}/source/${encodeURIComponent(String(sourceId))}/live.flv?preview_token=${encodeURIComponent(token)}`
  };
}

function verifySourcePreviewToken(token, stream, sourceId) {
  if (!token || !stream?.id || !stream?.name || !sourceId) return false;
  try {
    const decoded = jwt.verify(String(token), config.jwtSecret, { issuer: ISSUER, audience: AUDIENCE, subject: String(stream.id) });
    return decoded?.purpose === SOURCE_PURPOSE && Number(decoded.stream_id) === Number(stream.id)
      && String(decoded.stream_name) === String(stream.name) && String(decoded.source_id) === String(sourceId);
  } catch { return false; }
}

function verifyPreviewToken(token, stream) {
  if (!token || !stream?.id || !stream?.name) return false;
  try {
    const decoded = jwt.verify(String(token), config.jwtSecret, {
      issuer: ISSUER, audience: AUDIENCE, subject: String(stream.id)
    });
    return decoded?.purpose === PURPOSE
      && Number(decoded.stream_id) === Number(stream.id)
      && String(decoded.stream_name) === String(stream.name);
  } catch {
    return false;
  }
}

module.exports = {
  issuePreviewToken,
  issueSourcePreviewToken,
  verifyPreviewToken,
  verifySourcePreviewToken,
  ttlSeconds
};
