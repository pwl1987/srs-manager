const db = require('../database');
const config = require('../config');

function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

function setSetting(key, value) {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
}

function getAllSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const settings = {};
  for (const row of rows) settings[row.key] = row.value;
  return settings;
}

function getSrsConfig() {
  return {
    api_url: config.srsApiUrl,
    api_token: '***',
    port: 1935,
    hooks_enabled: true,
    forward_backend: `http://127.0.0.1:${config.port}/api/forward`
  };
}

function getNtpStatus() {
  try {
    const exec = require('child_process').execSync;
    const output = exec('date', { encoding: 'utf-8' }).trim();
    return { synced: true, system_time: new Date(output).toISOString(), offset_ms: 0 };
  } catch {
    return { synced: false, system_time: new Date().toISOString(), offset_ms: null };
  }
}

module.exports = { getSetting, setSetting, getAllSettings, getSrsConfig, getNtpStatus };
