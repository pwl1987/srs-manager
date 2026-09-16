#!/usr/bin/env node
// Basic E2E test for SRS Manager
// Run on the SRS server after deployment: node scripts/e2e-test.js
// This is a local test script that only communicates with localhost:3001

const URL = 'http://localhost:3001';

async function test(name, fn) {
  try {
    await fn();
    console.log(`PASS: ${name}`);
  } catch (err) {
    console.log(`FAIL: ${name}: ${err.message}`);
    process.exitCode = 1;
  }
}

async function main() {
  console.log(`Testing SRS Manager at ${URL}\n`);

  await test('Health check', async () => {
    const res = await fetch(`${URL}/api/health`);
    if (!res.ok) throw new Error(`Status ${res.status}`);
    const data = await res.json();
    if (data.status !== 'ok') throw new Error(data.status);
  });

  let accessToken = '';
  await test('Login', async () => {
    const res = await fetch(`${URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' })
    });
    if (!res.ok) throw new Error(`Status ${res.status}: ${await res.text()}`);
    const data = await res.json();
    accessToken = data.access_token;
    if (!accessToken) throw new Error('No access token returned');
  });

  await test('Get streams', async () => {
    const res = await fetch(`${URL}/api/streams`, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    if (!res.ok) throw new Error(`Status ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error('Not an array');
  });

  let streamId = '';
  await test('Create stream', async () => {
    const res = await fetch(`${URL}/api/streams`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      },
      body: JSON.stringify({ name: 'test-stream', protocol: 'rtmp' })
    });
    if (!res.ok) throw new Error(`Status ${res.status}: ${await res.text()}`);
    const data = await res.json();
    streamId = data.id;
    if (!streamId) throw new Error('No stream ID returned');
  });

  await test('Get stream', async () => {
    const res = await fetch(`${URL}/api/streams/${streamId}`, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    if (!res.ok) throw new Error(`Status ${res.status}`);
    const data = await res.json();
    if (data.name !== 'test-stream') throw new Error(`Wrong name: ${data.name}`);
  });

  await test('Create auth key', async () => {
    const res = await fetch(`${URL}/api/keys`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      },
      body: JSON.stringify({ type: 'push', stream_id: streamId, description: 'Test key' })
    });
    if (!res.ok) throw new Error(`Status ${res.status}: ${await res.text()}`);
    const data = await res.json();
    if (!data.key || !data.key.includes('****')) throw new Error('Key not masked');
  });

  await test('Create distribution request', async () => {
    const res = await fetch(`${URL}/api/distribution`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      },
      body: JSON.stringify({
        stream_id: streamId,
        applicant: 'Test Company',
        pull_url: 'rtmp://cdn.example.com/live/test-stream',
        expires_at: new Date(Date.now() + 86400000).toISOString()
      })
    });
    if (!res.ok) throw new Error(`Status ${res.status}: ${await res.text()}`);
    const data = await res.json();
    if (data.status !== 'active') throw new Error(`Status: ${data.status}`);
  });

  await test('Create external source', async () => {
    const res = await fetch(`${URL}/api/external-sources`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      },
      body: JSON.stringify({ name: 'Test Source', source_url: 'rtmp://external.example.com/live/test', protocol: 'rtmp', pull_mode: 'pull' })
    });
    if (!res.ok) throw new Error(`Status ${res.status}: ${await res.text()}`);
  });

  await test('Create transcode template', async () => {
    const res = await fetch(`${URL}/api/transcode-templates`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      },
      body: JSON.stringify({
        name: '720p',
        vcodec: 'h264',
        acodec: 'aac',
        video_config: JSON.stringify({ width: 1280, height: 720, fps: 30, bitrate: 2000 }),
        audio_config: JSON.stringify({ bitrate: 128 }),
        output_format: 'rtmp'
      })
    });
    if (!res.ok) throw new Error(`Status ${res.status}: ${await res.text()}`);
  });

  await test('Monitor dashboard', async () => {
    const res = await fetch(`${URL}/api/monitor/dashboard`, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    if (!res.ok) throw new Error(`Status ${res.status}`);
    const data = await res.json();
    if (typeof data.online_streams !== 'number') throw new Error('Missing online_streams');
  });

  await test('Get settings', async () => {
    const res = await fetch(`${URL}/api/settings/srs-config`, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    if (!res.ok) throw new Error(`Status ${res.status}`);
    const data = await res.json();
    if (!data.api_url) throw new Error('Missing api_url');
  });

  await test('Delete test stream', async () => {
    const res = await fetch(`${URL}/api/streams/${streamId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    if (!res.ok) throw new Error(`Status ${res.status}`);
  });

  console.log('\n=== E2E Test Complete ===');
}

main();
