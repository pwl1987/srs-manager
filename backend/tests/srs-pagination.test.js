const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'srs-manager-pagination-'));
process.env.DATA_DIR = dataDir;
process.env.SRS_API_URL = 'http://srs.test/api/v1';

const db = require('../database');
const srsService = require('../services/srs');

function makeResponse(items, field) {
  return {
    ok: true,
    json: async () => ({ [field]: items })
  };
}

test('SRS list APIs paginate instead of silently truncating at the default 10', async (t) => {
  const originalFetch = global.fetch;
  const calls = [];

  global.fetch = async (url) => {
    const parsed = new URL(url);
    const start = Number(parsed.searchParams.get('start') || 0);
    const count = Number(parsed.searchParams.get('count') || 10);
    calls.push({ pathname: parsed.pathname, start, count });

    if (parsed.pathname.endsWith('/clients')) {
      const all = Array.from({ length: 205 }, (_, index) => ({ id: index + 1 }));
      return makeResponse(all.slice(start, start + count), 'clients');
    }

    if (parsed.pathname.endsWith('/streams')) {
      const all = Array.from({ length: 137 }, (_, index) => ({ id: index + 1, name: `stream-${index + 1}` }));
      return makeResponse(all.slice(start, start + count), 'streams');
    }

    throw new Error(`Unexpected URL ${url}`);
  };

  t.after(() => {
    global.fetch = originalFetch;
  });

  const clients = await srsService.listClients();
  assert.equal(clients.length, 205);
  assert.deepEqual(
    calls.filter(call => call.pathname.endsWith('/clients')).map(call => call.start),
    [0, 100, 200]
  );

  const streams = await srsService.getStreams();
  assert.equal(streams.length, 137);
  assert.deepEqual(
    calls.filter(call => call.pathname.endsWith('/streams')).map(call => call.start),
    [0, 100]
  );
});


test('SRS client helpers understand opaque stream/client ids from current SRS API', async (t) => {
  const originalFetch = global.fetch;
  let deletedPath = null;
  global.fetch = async (url, init = {}) => {
    const parsed = new URL(url);
    if (init.method === 'DELETE') {
      deletedPath = parsed.pathname;
      return { ok: true, json: async () => ({ code: 0 }) };
    }
    throw new Error(`Unexpected URL ${url}`);
  };

  t.after(() => {
    global.fetch = originalFetch;
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const publisher = {
    id: 'h0i75x23',
    type: 'fmle-publish',
    stream: 'vid-8a69um9',
    name: 'news-main',
    url: '/live/news-main',
    ip: '10.30.5.199'
  };
  assert.equal(srsService.clientAppName(publisher), 'live');
  assert.equal(srsService.clientStreamName(publisher), 'news-main');
  assert.equal(srsService.clientMatchesStream(publisher, 'news-main', 'live'), true);
  assert.equal(srsService.clientMatchesStream(publisher, 'other', 'live'), false);

  await srsService.kickClient('h0i75x23');
  assert.ok(deletedPath.endsWith('/clients/h0i75x23'));
  await assert.rejects(() => srsService.kickClient('../bad'), /Invalid client ID/);
});
