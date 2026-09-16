#!/usr/bin/env node
/**
 * 网宿 CDN API 签名验证脚本
 * 独立运行，验证 CNC-HMAC-SHA256 签名算法正确性
 *
 * 用法：
 *   node scripts/wangsu-sign-test.js <AccessKeyId> <AccessKeySecret>
 *
 * 从环境变量读取（优先）：
 *   WANGSU_ACCESS_KEY_ID, WANGSU_ACCESS_KEY_SECRET
 */

const crypto = require('crypto');
const https = require('https');

function getCryptoKey() {
  const id = process.env.WANGSU_ACCESS_KEY_ID || process.argv[2];
  const secret = process.env.WANGSU_ACCESS_KEY_SECRET || process.argv[3];
  if (!id || !secret) {
    console.error('Usage: node wangsu-sign-test.js <AccessKeyId> <AccessKeySecret>');
    console.error('Or set env vars: WANGSU_ACCESS_KEY_ID, WANGSU_ACCESS_KEY_SECRET');
    process.exit(1);
  }
  return { id, secret };
}

function signRequest({ accessKeyId, accessKeySecret, method, path, headers = {} }) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const contentType = headers['content-type'] || 'application/json';
  const host = 'api.wangsu.com';

  // 构造规范化请求字符串
  const signedHeaders = ['content-type', 'host'].join(';');
  const canonicalRequest = [
    method.toUpperCase(),
    path,
    '', // query string (empty for POST)
    `content-type:${contentType}`,
    `host:${host}`,
    '',
    signedHeaders,
    accessKeyId
  ].join('\n');

  // HMAC-SHA256 签名
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

function makeRequest(headers, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body || {});
    const req = https.request({
      hostname: 'api.wangsu.com',
      path: '/cnc/2016-10-11/getChannelList',
      method: 'POST',
      headers: { ...headers, 'content-length': Buffer.byteLength(data) }
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          resolve({ status: res.statusCode, data: json });
        } catch (e) {
          resolve({ status: res.statusCode, data: body });
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function main() {
  const { id, secret } = getCryptoKey();
  console.log(`AccessKeyId: ${id}`);
  console.log(`Testing CNC-HMAC-SHA256 signature...`);

  const headers = signRequest({
    accessKeyId: id,
    accessKeySecret: secret,
    method: 'POST',
    path: '/cnc/2016-10-11/getChannelList'
  });

  const result = await makeRequest(headers, {
    ChannelName: '',
    ChannelId: '',
    PageNo: 1,
    PageSize: 10
  });

  if (result.status === 200) {
    const data = result.data;
    if (data.RetCode === '000000') {
      console.log(`\n✓ Signature valid! API returned success.`);
      console.log(`  Total channels: ${data.TotalCount}`);
      if (data.Channels && data.Channels.length > 0) {
        console.log(`  First channel: ${data.Channels[0].ChannelName} (ID: ${data.Channels[0].ChannelId})`);
      }
    } else {
      console.log(`\n✗ API returned error code: ${data.RetCode}`);
      console.log(`  Message: ${data.RetMsg}`);
      if (data.RetCode === '100001' || data.RetCode === '100002') {
        console.log(`  → AccessKey ID or Secret is invalid`);
      }
    }
  } else {
    console.log(`\n✗ HTTP status: ${result.status}`);
    console.log(`  Response: ${result.data}`);
    if (result.status === 403) {
      console.log(`  → Signature verification failed. Check signing algorithm and timestamp sync.`);
    }
  }
}

main().catch(err => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
