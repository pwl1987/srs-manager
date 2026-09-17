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

async function getStreams() {
  const data = await request('GET', '/streams');
  return data.streams || [];
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

async function listClients() {
  const data = await request('GET', '/clients');
  return data.clients || [];
}

async function kickClient(id) {
  const numeric = parseInt(id, 10);
  if (!Number.isInteger(numeric) || numeric <= 0) throw new Error('Invalid client ID');
  return request('DELETE', `/clients/${numeric}`);
}

module.exports = { getStreams, getStreamByName, getStreamStats, getVersion, listClients, kickClient };
