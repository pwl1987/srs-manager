const settingsService = require('./settings-service');

function request(method, path, body) {
  const baseUrl = settingsService.getSrsApiUrl();
  const token = settingsService.getSrsApiToken();
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  }).then(res => {
    if (!res.ok) {
      throw new Error(`SRS API error: ${res.status} - ${res.statusText}`);
    }
    return res.json();
  });
}

async function listPaginated(path, field, { pageSize = 100, maxItems = 10000 } = {}) {
  const items = [];
  let start = 0;

  while (items.length < maxItems) {
    const remaining = maxItems - items.length;
    const count = Math.min(pageSize, remaining);
    const separator = path.includes('?') ? '&' : '?';
    const data = await request('GET', `${path}${separator}start=${start}&count=${count}`);
    const batch = Array.isArray(data?.[field]) ? data[field] : [];
    if (batch.length === 0) break;

    items.push(...batch);
    start += batch.length;
    if (batch.length < count) break;
  }

  return items;
}

async function getStreams(options) {
  return listPaginated('/streams', 'streams', options);
}

// 流名称在创建时限定为 [a-zA-Z0-9_-]；出站请求前再做一次白名单变换，
// 确保任何来源的名称都不可能携带路径/查询注入字符进入 SRS API URL
function safeStreamName(name) {
  return String(name || '').replace(/[^a-zA-Z0-9_-]/g, '');
}

async function getStreamByName(name) {
  const data = await request('GET', `/streams/${encodeURIComponent(safeStreamName(name))}`);
  return data.stream || null;
}

async function getStreamStats(name) {
  const data = await request('GET', `/streams/${encodeURIComponent(safeStreamName(name))}/stats`);
  return data.stats || null;
}

async function getVersion() {
  const data = await request('GET', '/version');
  return data;
}

async function listClients(options) {
  return listPaginated('/clients', 'clients', options);
}


function clientUrlIdentity(client) {
  const raw = String(client?.url || client?.stream_url || '').trim();
  if (!raw) return { app: null, stream: null };
  let pathname = raw.split(/[?#]/, 1)[0];
  try {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) pathname = new URL(raw).pathname;
  } catch {}
  const parts = pathname.split('/').filter(Boolean).map(part => {
    try { return decodeURIComponent(part); } catch { return part; }
  });
  if (parts.length < 2) return { app: null, stream: null };
  const app = parts[0];
  const stream = parts.slice(1).join('/').replace(/\.(?:m3u8|flv)$/i, '');
  return { app, stream };
}

function clientAppName(client) {
  return client?.app ? String(client.app) : clientUrlIdentity(client).app;
}

function clientStreamName(client) {
  const explicit = client?.stream_name ?? client?.streamName;
  if (explicit) return String(explicit);
  const fromUrl = clientUrlIdentity(client).stream;
  if (fromUrl) return fromUrl;
  const fallback = client?.stream;
  return fallback ? String(fallback) : null;
}

function clientMatchesStream(client, streamName, app = 'live') {
  const expected = String(streamName || '');
  if (!expected) return false;
  const identity = clientUrlIdentity(client);
  const clientApp = client?.app || identity.app;
  if (clientApp && app && clientApp !== app) return false;
  if (client?.stream_name === expected || client?.streamName === expected || client?.stream === expected) return true;
  return identity.stream === expected;
}

async function kickClient(id) {
  const value = String(id ?? '').trim();
  if (!value || value.length > 128 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid client ID');
  return request('DELETE', `/clients/${encodeURIComponent(value)}`);
}

module.exports = {
  getStreams,
  getStreamByName,
  getStreamStats,
  getVersion,
  listClients,
  kickClient,
  clientAppName,
  clientStreamName,
  clientMatchesStream
};
