const db = require('../database');
const config = require('../config');

// Keys the API accepts in PUT /api/settings. Everything else is rejected.
const SETTABLE_KEYS = ['dns_domain', 'cdn_domain', 'srs_api_url', 'srs_api_token', 'srs_rtmp_port', 'srs_http_port', 'timezone'];

function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

function setSetting(key, value) {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, String(value));
}

function getAllSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const settings = {};
  for (const row of rows) settings[row.key] = row.value;
  return settings;
}

// Effective SRS connection values: DB override first, env config as default.
function getSrsApiUrl() {
  return getSetting('srs_api_url') || config.srsApiUrl;
}

function getSrsApiToken() {
  return getSetting('srs_api_token') || config.srsApiToken;
}

function getSrsApiUsername() {
  return config.srsApiUsername;
}

function getSrsApiPassword() {
  return config.srsApiPassword;
}

function getRtmpPort() {
  const port = parseInt(getSetting('srs_rtmp_port'), 10);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : 1935;
}

// SRS http_server port: serves HLS / http-flv on the media host.
function getSrsHttpPort() {
  const port = parseInt(getSetting('srs_http_port'), 10);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : 8080;
}

function getCdnDomain() {
  return getSetting('cdn_domain') || 'cdn.example.com';
}

function isCdnDomainConfigured() {
  const v = getSetting('cdn_domain');
  // example.com is a reserved documentation domain: treat the placeholder
  // (e.g. an early cdn.example.com value stored before this check) as unset.
  return Boolean(v) && !v.includes('example.com');
}function getSrsConfig() {
  const token = getSrsApiToken();
  const basicAuthSet = Boolean(getSrsApiUsername() && getSrsApiPassword());
  return {
    api_url: getSrsApiUrl(),
    api_token_set: Boolean(token),
    api_basic_auth_set: basicAuthSet,
    api_auth_mode: token ? 'bearer' : (basicAuthSet ? 'basic' : 'none'),
    rtmp_port: getRtmpPort(),
    hooks_enabled: true,
    forward_backend: `http://127.0.0.1:${config.port}/api/forward`
  };
}

function getNtpStatus() {
  try {
    const { execFileSync } = require('child_process');
    const output = execFileSync(
      'timedatectl',
      ['show', '-p', 'NTPSynchronized', '-p', 'NTP', '--value'],
      { encoding: 'utf-8', timeout: 5000 }
    );
    const values = output.trim().split('\n').map(v => v.trim());
    return {
      supported: true,
      synced: values[0] === 'yes',
      ntp_active: values[1] === 'active',
      system_time: new Date().toISOString()
    };
  } catch {
    // timedatectl unavailable (non-systemd or restricted container)
    return { supported: false, synced: null, ntp_active: null, system_time: new Date().toISOString() };
  }
}

module.exports = {
  SETTABLE_KEYS,
  getSetting, setSetting, getAllSettings, getSrsConfig, getNtpStatus,
  getSrsApiUrl, getSrsApiToken, getSrsApiUsername, getSrsApiPassword,
  getRtmpPort, getSrsHttpPort, getCdnDomain, isCdnDomainConfigured
};
