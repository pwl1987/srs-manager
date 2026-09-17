const crypto = require('crypto');
const https = require('https');

const BASE_URL = 'https://dns.alidns.com';
const API_VERSION = '2015-12-01';
const DEFAULT_REGION = 'cn-hangzhou';

let authCredentials = null;

function setCredentials(accessKeyId, accessKeySecret) {
  authCredentials = { accessKeyId, accessKeySecret };
}

function getCredentials() {
  return authCredentials;
}

function signRequest(method, params) {
  const sorted = Object.keys(params).sort();
  const queryString = sorted.map(k => {
    return `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`;
  }).join('&');

  const stringToSign = `${method}&%2F&${encodeURIComponent(queryString)}`;
  const hmac = crypto.createHmac('sha256', authCredentials.accessKeySecret + '&');
  hmac.update(stringToSign);
  const signature = hmac.digest('base64');

  return `${queryString}&Signature=${encodeURIComponent(signature)}`;
}

function apiRequest(action, params = {}) {
  return new Promise((resolve, reject) => {
    if (!authCredentials) {
      return reject(new Error('ALIYUN_AUTH_MISSING'));
    }

    const baseParams = {
      Action: action,
      Version: API_VERSION,
      AccessKeyId: authCredentials.accessKeyId,
      RegionId: DEFAULT_REGION,
      SignatureMethod: 'HMAC-SHA256',
      SignatureVersion: '1.0',
      Timestamp: new Date().toISOString().replace(/\.\d+Z$/, 'Z')
    };

    const allParams = { ...baseParams, ...params };
    const signedQuery = signRequest('GET', allParams);

    const url = `${BASE_URL}/?${signedQuery}`;

    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.Code) {
            reject(new Error(parsed.Code));
          } else {
            resolve(parsed);
          }
        } catch (e) {
          reject(new Error('ALIYUN_API_PARSE_ERROR'));
        }
      });
      res.on('error', reject);
    });
  });
}

async function describeDomains() {
  return apiRequest('DescribeDomains', {});
}

async function describeDomainRecords(domain, rr, type) {
  const params = { DomainName: domain };
  if (rr) params.RR = rr;
  if (type) params.Type = type;
  return apiRequest('DescribeDomainRecords', params);
}

async function addDomainRecord(domain, rr, type, value, ttl) {
  return apiRequest('AddDomainRecord', {
    DomainName: domain,
    RR: rr,
    Type: type,
    RecordValue: value,
    TTL: ttl || 600
  });
}

async function updateDomainRecord(recordId, rr, type, value, ttl) {
  return apiRequest('UpdateDomainRecord', {
    RecordId: recordId,
    RR: rr,
    Type: type,
    RecordValue: value,
    TTL: ttl || 600
  });
}

async function deleteDomainRecord(recordId) {
  return apiRequest('DeleteDomainRecord', { RecordId: recordId });
}

async function verifyCredentials() {
  try {
    const result = await describeDomains();
    if (result.Domains && result.Domains.Domain) {
      return { valid: true, domains: result.Domains.Domain };
    }
    return { valid: true, domains: [] };
  } catch (e) {
    return { valid: false, error: e.message };
  }
}

module.exports = {
  setCredentials,
  getCredentials,
  describeDomains,
  describeDomainRecords,
  addDomainRecord,
  updateDomainRecord,
  deleteDomainRecord,
  verifyCredentials
};
