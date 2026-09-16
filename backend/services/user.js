const db = require('../database');
const config = require('../config');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function verifyPassword(plaintext, hash) {
  return bcrypt.compare(plaintext, hash);
}

function createAccessToken(userId, username) {
  return jwt.sign({ userId, username }, config.jwtSecret, {
    expiresIn: config.accessTokenTTL
  });
}

function createRefreshToken(userId) {
  return crypto.randomBytes(48).toString('hex');
}

function storeRefreshToken(userId, token) {
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + config.refreshTokenTTL * 1000).toISOString();
  db.prepare('INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)')
    .run(userId, tokenHash, expiresAt);
}

function validateRefreshToken(token) {
  const tokenHash = hashToken(token);
  const row = db.prepare('SELECT * FROM refresh_tokens WHERE token_hash = ?').get(tokenHash);
  if (!row) return null;
  if (new Date(row.expires_at) < new Date()) {
    db.prepare('DELETE FROM refresh_tokens WHERE id = ?').run(row.id);
    return null;
  }
  db.prepare('DELETE FROM refresh_tokens WHERE id = ?').run(row.id); // One-time use
  return row.user_id;
}

function revokeRefreshToken(token) {
  const tokenHash = hashToken(token);
  db.prepare('DELETE FROM refresh_tokens WHERE token_hash = ?').run(tokenHash);
}

function recordLogin(username, ip, success, reason) {
  db.prepare('INSERT INTO login_logs (username, ip, success, reason) VALUES (?, ?, ?, ?)')
    .run(username, ip, success ? 1 : 0, reason || null);
}

function checkLoginLock(username) {
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) return null;
  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    return user.locked_until;
  }
  return null;
}

function incrementLoginFail(username) {
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) return;
  const newCount = user.login_fail_count + 1;
  let lockedUntil = null;
  if (newCount >= config.loginFailLimit) {
    lockedUntil = new Date(Date.now() + config.loginLockDuration).toISOString();
  }
  db.prepare('UPDATE users SET login_fail_count = ?, locked_until = ? WHERE id = ?')
    .run(newCount, lockedUntil, user.id);
}

function resetLoginFail(username) {
  db.prepare('UPDATE users SET login_fail_count = 0, locked_until = NULL WHERE username = ?')
    .run(username);
}

async function login(username, password, ip) {
  const lockedUntil = checkLoginLock(username);
  if (lockedUntil) {
    return { error: `Account locked until ${lockedUntil}` };
  }

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) {
    recordLogin(username, ip, 0, 'User not found');
    incrementLoginFail(username);
    return { error: 'Invalid username or password' };
  }

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) {
    recordLogin(username, ip, 0, 'Invalid password');
    incrementLoginFail(username);
    return { error: 'Invalid username or password' };
  }

  resetLoginFail(username);
  db.prepare('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?').run(user.id);
  recordLogin(username, ip, 1, 'Success');

  const accessToken = createAccessToken(user.id, user.username);
  const refreshToken = createRefreshToken(user.id);
  storeRefreshToken(user.id, refreshToken);

  return { user: { id: user.id, username: user.username, role: user.role }, accessToken, refreshToken };
}

function refresh(refreshToken) {
  const userId = validateRefreshToken(refreshToken);
  if (!userId) return null;

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) return null;

  const accessToken = createAccessToken(user.id, user.username);
  const newRefreshToken = createRefreshToken(user.id);
  storeRefreshToken(user.id, newRefreshToken);

  return { user: { id: user.id, username: user.username, role: user.role }, accessToken, refreshToken: newRefreshToken };
}

function logout(refreshToken) {
  revokeRefreshToken(refreshToken);
}

module.exports = { login, refresh, logout, verifyPassword, hashToken };
