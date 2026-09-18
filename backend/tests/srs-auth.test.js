const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'srs-manager-srs-auth-'));
process.env.DATA_DIR = dataDir;

const settings = require('../services/settings-service');
const srs = require('../services/srs');

const originals = {
  fetch: global.fetch,
  url: settings.getSrsApiUrl,
  token: settings.getSrsApiToken,
  username: settings.getSrsApiUsername,
  password: settings.getSrsApiPassword
};

test.after(() => {
  global.fetch = originals.fetch;
  settings.getSrsApiUrl = originals.url;
  settings.getSrsApiToken = originals.token;
  settings.getSrsApiUsername = originals.username;
  settings.getSrsApiPassword = originals.password;
  fs.rmSync(dataDir, { recursive: true, force: true });
});

function captureAuthorization() {
  let authorization;
  global.fetch = async (_url, init) => {
    authorization = init.headers.Authorization;
    return new Response(JSON.stringify({ code: 0 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };
  return () => authorization;
}

test('Bearer token remains preferred when configured', async () => {
  settings.getSrsApiUrl = () => 'http://127.0.0.1:1985/api/v1';
  settings.getSrsApiToken = () => 'bearer-secret';
  settings.getSrsApiUsername = () => 'legacy-user';
  settings.getSrsApiPassword = () => 'legacy-pass';
  const authorization = captureAuthorization();

  await srs.getVersion();
  assert.equal(authorization(), 'Bearer bearer-secret');
});

test('Basic auth supports installed SRS 6.x when Bearer is unavailable', async () => {
  settings.getSrsApiUrl = () => 'http://127.0.0.1:1985/api/v1';
  settings.getSrsApiToken = () => '';
  settings.getSrsApiUsername = () => 'srs-manager';
  settings.getSrsApiPassword = () => 'basic-secret';
  const authorization = captureAuthorization();

  await srs.getVersion();
  const expected = Buffer.from('srs-manager:basic-secret').toString('base64');
  assert.equal(authorization(), `Basic ${expected}`);
});
