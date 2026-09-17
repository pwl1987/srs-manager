const crypto = require('crypto');
const db = require('../database');

const INTERNAL_MEDIA_KEY = 'runtime.internal_media_token';
let cached = null;

function getInternalMediaToken() {
  if (cached) return cached;
  const initialize = db.transaction(() => {
    const existing = db.prepare('SELECT value FROM settings WHERE key = ?').get(INTERNAL_MEDIA_KEY);
    if (existing?.value) return existing.value;

    const candidate = crypto.randomBytes(32).toString('base64url');
    db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)')
      .run(INTERNAL_MEDIA_KEY, candidate);
    return db.prepare('SELECT value FROM settings WHERE key = ?').get(INTERNAL_MEDIA_KEY)?.value || candidate;
  });
  cached = initialize.immediate();
  return cached;
}

function matchesInternalMediaToken(candidate) {
  if (!candidate) return false;
  const expected = Buffer.from(getInternalMediaToken());
  const actual = Buffer.from(String(candidate));
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}

module.exports = { getInternalMediaToken, matchesInternalMediaToken };
