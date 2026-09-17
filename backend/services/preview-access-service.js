const { randomUUID } = require('crypto');
const jwt = require('jsonwebtoken');
const config = require('../config');

const PURPOSE = 'operator_preview';
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
  return {
    token,
    expires_at: new Date(Date.now() + ttl * 1000).toISOString(),
    ttl_seconds: ttl,
    preview_url: `/api/preview/${encodeURIComponent(stream.id)}/index.m3u8?preview_token=${encodeURIComponent(token)}`
  };
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
  verifyPreviewToken,
  ttlSeconds
};
