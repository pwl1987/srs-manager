const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const jwt = require('jsonwebtoken');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'srs-manager-origin-api-'));
process.env.DATA_DIR = dataDir;
process.env.JWT_SECRET = 'test-origin-exposure-secret';
process.env.SRS_API_URL = 'http://127.0.0.1:1985/api/v1';
delete process.env.EXPOSE_SRS_HTTP_ORIGIN_URLS;

const config = require('../../config');
const streamsRouter = require('../../routes/streams');

function startApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/streams', streamsRouter);
  return new Promise(resolve => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function request(server, pathname = '', init = {}) {
  const { port } = server.address();
  const token = jwt.sign({ sub: 'ci-user', role: 'admin' }, config.jwtSecret, { expiresIn: '5m' });
  const response = await fetch(`http://127.0.0.1:${port}/api/streams${pathname}`, {
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

test('stream API hides raw SRS HTTP origin URLs by default using real SQLite', async (t) => {
  const server = await startApp();
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const created = await request(server, '', {
    method: 'POST',
    body: JSON.stringify({ name: 'secure-origin', protocol: 'rtmp' })
  });
  assert.equal(created.response.status, 201);
  assert.equal(created.body.stream.origin_pull_url_hls, null);
  assert.equal(created.body.stream.origin_pull_url_flv, null);
  assert.equal(created.body.stream.origin_http_exposed, false);
  const fetched = await request(server, `/${created.body.stream.id}`);
  assert.equal(fetched.response.status, 200);
  assert.equal(fetched.body.stream.origin_pull_url_hls, null);
  assert.equal(fetched.body.stream.origin_pull_url_flv, null);
  assert.equal(fetched.body.stream.origin_http_exposed, false);
  assert.ok(fetched.body.stream.origin_pull_url_rtmp.startsWith('rtmp://'));
});
