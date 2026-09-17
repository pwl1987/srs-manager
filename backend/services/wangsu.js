const crypto = require('crypto');
const db = require('../database');

const API_HOST = 'api.wangsu.com';
const API_BASE = '/cnc/2016-10-11';

// Rate limiting: 300 req/5min global, 30 req/5min per endpoint
const globalTokens = { count: 0, resetAt: Date.now() + 5 * 60 * 1000 };
const endpointTokens = {};

function checkRateLimit(endpoint) {
  const now = Date.now();

  if (now > globalTokens.resetAt) {
    globalTokens.count = 0;
    globalTokens.resetAt = now + 5 * 60 * 1000;
  }
  if (globalTokens.count >= 300) {
    throw new Error('Wangsu API global rate limit exceeded (300 req/5min)');
  }
  globalTokens.count++;

  if (!endpointTokens[endpoint]) {
    endpointTokens[endpoint] = { count: 0, resetAt: now + 5 * 60 * 1000 };
  }
  if (now > endpointTokens[endpoint].resetAt) {
    endpointTokens[endpoint].count = 0;
    endpointTokens[endpoint].resetAt = now + 5 * 60 * 1000;
  }
  if (endpointTokens[endpoint].count >= 30) {
    throw new Error(`Wangsu API rate limit exceeded for endpoint "${endpoint}" (30 req/5min)`);
  }
  endpointTokens[endpoint].count++;
}

function getCredentials() {
  const row = db.prepare('SELECT * FROM wangsu_auth WHERE verified = 1 ORDER BY id DESC LIMIT 1').get();
  if (!row) {
    throw new Error('Wangsu AccessKey not configured. Please configure via the panel UI.');
  }
  return { accessKeyId: row.access_key_id, accessKeySecret: row.access_key_secret };
}

function isConfigured() {
  const row = db.prepare('SELECT 1 FROM wangsu_auth WHERE verified = 1 ORDER BY id DESC LIMIT 1').get();
  return Boolean(row);
}

function signRequest({ accessKeyId, accessKeySecret, method, path, headers = {} }) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const contentType = headers['content-type'] || 'application/json';
  const host = API_HOST;

  const signedHeaders = ['content-type', 'host'].join(';');
  const canonicalRequest = [
    method.toUpperCase(),
    path,
    '',
    `content-type:${contentType}`,
    `host:${host}`,
    '',
    signedHeaders,
    accessKeyId
  ].join('\n');

  const signature = crypto
    .createHmac('sha256', accessKeySecret)
    .update(canonicalRequest)
    .digest('base64');

  return {
    'x-cnc-accessKey': accessKeyId,
    'x-cnc-timestamp': timestamp,
    'x-cnc-auth-method': 'AKSK',
    'content-type': contentType,
    'Authorization': `CNC-HMAC-SHA256 Credential=${accessKeyId}, SignedHeaders=${signedHeaders}, Signature=${signature}`
  };
}

async function apiRequest(endpoint, body) {
  const { accessKeyId, accessKeySecret } = getCredentials();
  checkRateLimit(endpoint);

  const path = `${API_BASE}/${endpoint}`;
  const headers = signRequest({ accessKeyId, accessKeySecret, method: 'POST', path });
  const data = JSON.stringify(body || {});

  const res = await fetch(`https://${API_HOST}${path}`, {
    method: 'POST',
    headers: { ...headers, 'content-length': Buffer.byteLength(data) },
    body: data
  });

  if (!res.ok) {
    throw new Error(`Wangsu API HTTP error: ${res.status} ${res.statusText}`);
  }

  const json = await res.json();
  if (json.RetCode !== '000000') {
    throw new Error(`Wangsu API error: ${json.RetCode} - ${json.RetMsg}`);
  }
  return json;
}

// API methods
async function createChannel({ ChannelName, PushDomain, PullDomain }) {
  return apiRequest('createChannel', { ChannelName, PushDomain, PullDomain });
}

async function getChannelList(params = {}) {
  return apiRequest('getChannelList', {
    ChannelName: params.channelName || '',
    ChannelId: params.channelId || '',
    PageNo: params.pageNo || 1,
    PageSize: params.pageSize || 20
  });
}

async function getChannelDetail(channelId) {
  return apiRequest('getChannelDetail', { ChannelId: channelId });
}

async function deleteChannel(channelId) {
  return apiRequest('deleteChannel', { ChannelId: channelId });
}

async function batchChannelLiveState(channelIds) {
  return apiRequest('batchChannelLiveState', { ChannelIds: channelIds });
}

async function setPullTsatc(channelId, tsatcConfig) {
  return apiRequest('setPullTsatc', {
    ChannelId: channelId,
    Enable: tsatcConfig.enable ? 1 : 0,
    Key: tsatcConfig.key,
    Algorithm: tsatcConfig.algorithm || 'MD5',
    Expires: tsatcConfig.expires || 3600
  });
}

async function setPushTsatc(channelId, tsatcConfig) {
  return apiRequest('setPushTsatc', {
    ChannelId: channelId,
    Enable: tsatcConfig.enable ? 1 : 0,
    Key: tsatcConfig.key,
    Algorithm: tsatcConfig.algorithm || 'MD5',
    Expires: tsatcConfig.expires || 3600
  });
}

async function channelForbidden(channelId) {
  return apiRequest('channelForbidden', { ChannelId: channelId });
}

async function channelReBroadcast(channelId) {
  return apiRequest('channelReBroadcast', { ChannelId: channelId });
}

// Verify credentials by calling getChannelList
async function verifyCredentials(accessKeyId, accessKeySecret) {
  const path = `${API_BASE}/getChannelList`;
  const headers = signRequest({ accessKeyId, accessKeySecret, method: 'POST', path });
  const data = JSON.stringify({ ChannelName: '', ChannelId: '', PageNo: 1, PageSize: 1 });

  const res = await fetch(`https://${API_HOST}${path}`, {
    method: 'POST',
    headers: { ...headers, 'content-length': Buffer.byteLength(data) },
    body: data
  });

  if (!res.ok) {
    return { valid: false, error: `HTTP ${res.status}` };
  }

  const json = await res.json();
  if (json.RetCode === '000000') {
    return { valid: true, totalChannels: json.TotalCount };
  }
  return { valid: false, error: `${json.RetCode}: ${json.RetMsg}` };
}

module.exports = {
  createChannel, getChannelList, getChannelDetail, deleteChannel,
  batchChannelLiveState, setPullTsatc, setPushTsatc,
  channelForbidden, channelReBroadcast, verifyCredentials, isConfigured
};
