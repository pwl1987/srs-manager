const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const jwt = require('jsonwebtoken');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'srs-manager-source-api-'));
process.env.DATA_DIR = dataDir;
process.env.JWT_SECRET = 'test-external-source-secret';

const db = require('../database');
const config = require('../config');
const externalSourcesRouter = require('../routes/external-sources');

function startApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/external-sources', externalSourcesRouter);
  return new Promise(resolve => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function request(server, pathname = '', init = {}) {
  const { port } = server.address();
  const token = jwt.sign({ sub: 'ci-user', role: 'admin' }, config.jwtSecret, { expiresIn: '5m' });
  const response = await fetch(`http://127.0.0.1:${port}/api/external-sources${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers || {})
    }
  });
  const body = await response.json();
  return { response, body };
}

test('external source API masks credentials and blank URL edit preserves the stored secret', async (t) => {
  const server = await startApp();
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const sourceUrl = 'rtmp://user:password@10.30.5.199/live/source?token=super-secret';
  const created = await request(server, '', {
    method: 'POST',
    body: JSON.stringify({
      name: 'partner-a',
      source_url: sourceUrl,
      protocol: 'rtmp',
      pull_mode: 'pull'
    })
  });

  assert.equal(created.response.status, 201);
  assert.equal(created.body.source_url, undefined);
  assert.ok(created.body.source_url_masked.includes('10.30.5.199/live/source'));
  assert.ok(!created.body.source_url_masked.includes('password'));
  assert.ok(!created.body.source_url_masked.includes('super-secret'));

  const listed = await request(server);
  assert.equal(listed.response.status, 200);
  assert.equal(listed.body.length, 1);
  assert.equal(listed.body[0].source_url, undefined);
  assert.ok(!JSON.stringify(listed.body).includes('super-secret'));

  const updated = await request(server, `/${created.body.id}`, {
    method: 'PUT',
    body: JSON.stringify({
      name: 'partner-a-renamed',
      source_url: '',
      protocol: 'rtmp',
      pull_mode: 'pull'
    })
  });

  assert.equal(updated.response.status, 200);
  assert.equal(updated.body.source_url, undefined);
  assert.equal(updated.body.name, 'partner-a-renamed');

  const stored = db.prepare('SELECT source_url FROM external_sources WHERE id = ?').get(created.body.id);
  assert.equal(stored.source_url, sourceUrl, 'blank edit must preserve the existing credential-bearing URL');
});
