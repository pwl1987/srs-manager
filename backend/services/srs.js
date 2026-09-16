const config = require('../config');

const BASE_URL = config.srsApiUrl;
const TOKEN = config.srsApiToken;

function request(method, path, body) {
  return fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {})
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

async function getStreamByName(name) {
  const data = await request('GET', `/streams/${encodeURIComponent(name)}`);
  return data.stream || null;
}

async function getStreamStats(name) {
  const data = await request('GET', `/streams/${encodeURIComponent(name)}/stats`);
  return data.stats || null;
}

async function getVersion() {
  const data = await request('GET', '/version');
  return data;
}

module.exports = { getStreams, getStreamByName, getStreamStats, getVersion };
