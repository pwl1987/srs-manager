const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const jwt = require('jsonwebtoken');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'srs-manager-basic-auth-'));
process.env.DATA_DIR = dataDir;
process.env.JWT_SECRET = 'test-srs-basic-auth-secret';
process.env.SRS_API_TOKEN = '';
process.env.SRS_API_USERNAME = 'srs-manager';
process.env.SRS_API_PASSWORD = 'integration-secret';

function listen(server) {
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

test('settings test-srs reaches a Basic-auth protected downstream SRS stub', async (t) => {
  const expected = 'Basic ' + Buffer.from('srs-manager:integration-secret').toString('base64');
  const downstream = http.createServer((req, res) => {
    if (req.headers.authorization !== expected) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ code: 401 }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ code: 0, version: '6.0.191' }));
  });
  await listen(downstream);
  const downstreamPort = downstream.address().port;
  process.env.SRS_API_URL = `http://127.0.0.1:${downstreamPort}`;

  const config = require('../../config');
  const settingsRouter = require('../../routes/settings');

  const app = express();
  app.use(express.json());
  app.use('/api/settings', settingsRouter);
  const manager = await listen(http.createServer(app));

  t.after(async () => {
    await new Promise(resolve => manager.close(resolve));
    await new Promise(resolve => downstream.close(resolve));
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const token = jwt.sign({ sub: 'ci-user', role: 'admin' }, config.jwtSecret, { expiresIn: '5m' });
  const response = await fetch(`http://127.0.0.1:${manager.address().port}/api/settings/test-srs`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.data.code, 0);
  assert.equal(body.data.version, '6.0.191');
});
