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
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
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
