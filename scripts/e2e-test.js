#!/usr/bin/env node

const BASE_URL = (process.env.BASE_URL || 'http://127.0.0.1:3001').replace(/\/$/, '');
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

if (!ADMIN_PASSWORD) {
  console.error('ADMIN_PASSWORD is required. Example: ADMIN_PASSWORD="..." node scripts/e2e-test.js');
  process.exit(2);
}

let accessToken = '';
let failures = 0;
const cleanup = [];

async function request(path, { auth = true, ...init } = {}) {
  const headers = { 'Content-Type': 'application/json', ...(init.headers || {}) };
  if (auth && accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const response = await fetch(`${BASE_URL}${path}`, { ...init, headers });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { response, body };
}

async function expectOk(path, options) {
  const result = await request(path, options);
  if (!result.response.ok) {
    throw new Error(`${result.response.status} ${path}: ${JSON.stringify(result.body)}`);
  }
  return result.body;
}

async function check(name, fn) {
  try {
    await fn();
    console.log(`PASS  ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL  ${name}: ${error.message}`);
  }
}

async function cleanupAll() {
  for (const action of cleanup.reverse()) {
    try { await action(); } catch (error) { console.warn(`WARN  cleanup: ${error.message}`); }
  }
}

async function main() {
  console.log(`SRS Manager control-plane smoke: ${BASE_URL}\n`);
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const streamName = `smoke_${suffix}`;
  let streamId;
  let sourceId;
  let pullTaskId;
  let pushTaskId;
  let keyId;
  let grantId;
  let grantToken;

  try {
    await check('health endpoint', async () => {
      const body = await expectOk('/api/health', { auth: false });
      if (body?.status !== 'ok') throw new Error(`unexpected health: ${JSON.stringify(body)}`);
    });

    await check('admin login', async () => {
      const body = await expectOk('/api/auth/login', {
        auth: false,
        method: 'POST',
        body: JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASSWORD })
      });
      accessToken = body?.access_token;
      if (!accessToken) throw new Error('access_token missing');
    });

    await check('create and read stream', async () => {
      const created = await expectOk('/api/streams', {
        method: 'POST', body: JSON.stringify({ name: streamName, protocol: 'rtmp' })
      });
      streamId = created?.stream?.id;
      if (!streamId) throw new Error(`stream.id missing: ${JSON.stringify(created)}`);
      cleanup.push(() => request(`/api/streams/${streamId}`, { method: 'DELETE' }));
      const fetched = await expectOk(`/api/streams/${streamId}`);
      if (fetched?.stream?.name !== streamName) throw new Error('stream read-back mismatch');
    });

    await check('auth key is one-time raw then masked in list', async () => {
      const created = await expectOk('/api/keys', {
        method: 'POST', body: JSON.stringify({ type: 'push', stream_id: streamId, description: 'smoke' })
      });
      keyId = created?.id;
      const raw = created?.key;
      if (!keyId || !raw || raw.includes('****')) throw new Error('new raw key was not returned once');
      cleanup.push(() => request(`/api/keys/${keyId}`, { method: 'DELETE' }));
      const keys = await expectOk('/api/keys');
      const listed = keys.find(item => item.id === keyId);
      if (!listed || listed.key === raw || String(listed.key).includes(raw)) throw new Error('raw key leaked in list');
    });

    await check('create external source and stopped IN-PULL task', async () => {
      const source = await expectOk('/api/external-sources', {
        method: 'POST', body: JSON.stringify({
          name: `smoke-source-${suffix}`,
          source_url: `rtmp://external.example.com/live/input?token=${suffix}`,
          protocol: 'rtmp', pull_mode: 'pull'
        })
      });
      sourceId = source?.id;
      if (!sourceId || source.source_url) throw new Error('source secret exposure or missing id');
      cleanup.push(() => request(`/api/external-sources/${sourceId}`, { method: 'DELETE' }));

      const task = await expectOk('/api/pull-tasks', {
        method: 'POST', body: JSON.stringify({ stream_id: streamId, external_source_id: sourceId })
      });
      pullTaskId = task?.id;
      if (!pullTaskId || task.desired_state !== 'STOPPED' || task.runtime_state !== 'STOPPED') {
        throw new Error(`unexpected pull task state: ${JSON.stringify(task)}`);
      }
      cleanup.push(() => request(`/api/pull-tasks/${pullTaskId}`, { method: 'DELETE' }));
    });

    await check('create stopped, masked OUT-PUSH task', async () => {
      const task = await expectOk('/api/forward-tasks', {
        method: 'POST', body: JSON.stringify({
          stream_id: streamId,
          target_type: 'custom_rtmp',
          target_url: `rtmp://push.example.com/live/output?token=${suffix}`,
          enabled: 0
        })
      });
      pushTaskId = task?.id;
      if (!pushTaskId || task.desired_state !== 'STOPPED' || task.runtime_state !== 'STOPPED') {
        throw new Error(`unexpected push task state: ${JSON.stringify(task)}`);
      }
      if (task.target_url || String(task.target_url_masked).includes(suffix)) throw new Error('OUT-PUSH target secret leaked');
      cleanup.push(() => request(`/api/forward-tasks/${pushTaskId}`, { method: 'DELETE' }));
    });

    await check('workspace exposes managed input/output control planes', async () => {
      const workspace = await expectOk(`/api/streams/${streamId}/workspace`);
      if (workspace?.inputs?.managed_pull?.task?.id !== pullTaskId) throw new Error('managed pull missing from workspace');
      const push = (workspace?.outputs?.forwards || []).find(item => item.id === pushTaskId);
      if (!push) throw new Error('managed OUT-PUSH missing from workspace');
      if (!workspace?.outputs?.out_pull?.policy) throw new Error('OUT-PULL policy missing from workspace');
    });

    await check('OUT-PULL rejects without grant and accepts a valid grant', async () => {
      await expectOk(`/api/out-pull/streams/${streamId}/policy`, {
        method: 'PUT', body: JSON.stringify({ endpoint_enabled: true, accepting_new_sessions: true, require_grant: true })
      });

      const denied = await expectOk('/api/hooks/on_play', {
        auth: false,
        method: 'POST',
        body: JSON.stringify({ stream: streamName, client_id: `denied-${suffix}`, ip: '198.51.100.10' })
      });
      if (denied?.code === 0) throw new Error('playback without grant was allowed');

      const grant = await expectOk(`/api/out-pull/streams/${streamId}/grants`, {
        method: 'POST', body: JSON.stringify({
          label: 'smoke grant',
          expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString()
        })
      });
      grantId = grant?.id;
      grantToken = grant?.token;
      if (!grantId || !grantToken) throw new Error('one-time grant token missing');

      const allowed = await expectOk('/api/hooks/on_play', {
        auth: false,
        method: 'POST',
        body: JSON.stringify({
          stream: streamName,
          client_id: `allowed-${suffix}`,
          ip: '198.51.100.11',
          param: `?access_token=${encodeURIComponent(grantToken)}`
        })
      });
      if (allowed?.code !== 0) throw new Error(`valid grant rejected: ${JSON.stringify(allowed)}`);

      await expectOk(`/api/out-pull/streams/${streamId}/grants/${grantId}/revoke`, { method: 'POST' });
      const revoked = await expectOk('/api/hooks/on_play', {
        auth: false,
        method: 'POST',
        body: JSON.stringify({
          stream: streamName,
          client_id: `revoked-${suffix}`,
          ip: '198.51.100.12',
          param: `?access_token=${encodeURIComponent(grantToken)}`
        })
      });
      if (revoked?.code === 0) throw new Error('revoked grant still allowed playback');

      await expectOk('/api/hooks/on_stop', {
        auth: false,
        method: 'POST',
        body: JSON.stringify({ stream: streamName, client_id: `allowed-${suffix}` })
      });
    });

    await check('restore OUT-PULL to open defaults', async () => {
      const policy = await expectOk(`/api/out-pull/streams/${streamId}/policy`, {
        method: 'PUT', body: JSON.stringify({ endpoint_enabled: true, accepting_new_sessions: true, require_grant: false })
      });
      if (!policy.endpoint_enabled || !policy.accepting_new_sessions || policy.require_grant) {
        throw new Error(`policy restore failed: ${JSON.stringify(policy)}`);
      }
    });
  } finally {
    await cleanupAll();
  }

  console.log(`\nSmoke complete: ${failures ? `${failures} failure(s)` : 'all checks passed'}`);
  process.exitCode = failures ? 1 : 0;
}

main().catch(async error => {
  console.error(`FATAL ${error.stack || error.message}`);
  await cleanupAll();
  process.exit(1);
});
