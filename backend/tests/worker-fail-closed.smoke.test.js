const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

// PHASE-09-FIX-02 worker fail-closed gate. Every worker boots against a fresh
// database, claims a desired-RUNNING task while a stub SRS reports its stream
// as live, and must drive that task into an explicit terminal FAILED state
// with the fail-closed message instead of spawning when no allowlisted
// ffmpeg/ffprobe exists (the CI host has none). Child coverage is merged via
// the inherited NODE_V8_COVERAGE directory.

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'srs-manager-fail-closed-'));
process.env.DATA_DIR = dataDir;
process.env.JWT_SECRET = 'worker-fail-closed-secret';
process.env.PULL_WORKER_POLL_MS = '400';
process.env.PUSH_WORKER_POLL_MS = '400';
process.env.TRANSCODE_WORKER_POLL_MS = '400';
process.env.RECORD_WORKER_POLL_MS = '400';

const db = require('../database');
const streamService = require('../services/stream-service');
const forwardService = require('../services/forward-service');
const pullTaskService = require('../services/pull-task-service');
const pushTaskService = require('../services/push-task-service');
const recordTaskService = require('../services/record-task-service');

const seeded = { streamNames: [], pull: null, push: null, record: null };

function startStubSrs() {
  globalThis.stubHits = [];
  const server = http.createServer((req, res) => {
    globalThis.stubHits.push(req.url);
    const url = req.url || '/';
    // /streams answers the live stream set (push/record input observation);
    // /clients answers publishing clients for the push/record INPUT streams
    // only. The pull worker refuses to pull a stream that already has a
    // publisher (input ownership conflict → BLOCKED), so the pull stream must
    // stay unpublished — the pull worker itself becomes its publisher.
    // NB: match on the path segment — requests arrive as /api/v1/streams?....
    const isStreams = /\/streams(\?|$)/.test(url);
    const body = isStreams
      ? { code: 0, streams: seeded.streamNames.map(name => ({ name, app: 'live' })) }
      : { code: 0, clients: seeded.observedInputs.map(name => ({ type: 'publish', app: 'live', stream_name: name, url: `rtmp://srs/live/${name}` })) };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

test.before(async () => {
  const stub = await startStubSrs();
  globalThis.stubSrsPort = stub.address().port;
  globalThis.stubServerClose = callback => stub.close(callback);

  const pullStream = await streamService.createStream('fail-closed-pull', 'rtmp');
  const pushStream = await streamService.createStream('fail-closed-push', 'rtmp');
  const recordStream = await streamService.createStream('fail-closed-record', 'rtmp');
  seeded.streamNames = ['fail-closed-pull', 'fail-closed-push', 'fail-closed-record'];
  seeded.observedInputs = ['fail-closed-push', 'fail-closed-record'];

  const source = forwardService.createSource({ name: '上游源', source_url: 'rtmp://stub.example/live/a', protocol: 'rtmp', pull_mode: 'pull' });
  const pullTask = pullTaskService.createTask({ stream_id: pullStream.id, external_source_id: source.id });
  pullTaskService.setDesiredState(pullTask.id, 'RUNNING');
  seeded.pull = pullTask.id;

  const pushTask = pushTaskService.createTask({ stream_id: pushStream.id, target_type: 'rtmp', target_url: 'rtmp://stub.example/live/out', enabled: 1 });
  seeded.push = pushTask.id;

  const recordTask = recordTaskService.createTask({ stream_id: recordStream.id, name: '整场录制', format: 'mp4', segment_seconds: 6 });
  recordTaskService.setDesiredState(recordTask.id, 'RUNNING');
  seeded.record = recordTask.id;
});

test.after(async () => {
  await new Promise(resolve => globalThis.stubServerClose ? globalThis.stubServerClose(resolve) : resolve());
  db.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

function runWorker(workerFile, expectLines) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [path.join(__dirname, '..', workerFile)], {
      env: {
        ...process.env,
        SRS_API_URL: `http://127.0.0.1:${globalThis.stubSrsPort}/api/v1`
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let out = '';
    let settled = false;
    const finish = (code, signal) => {
      if (settled) return;
      settled = true;
      if (code === 0) resolve(out);
      else reject(new Error(`${workerFile} exited code=${code} signal=${signal}\n${out.slice(-800)}`));
    };
    child.stdout.on('data', chunk => { out += chunk.toString('utf8'); });
    child.stderr.on('data', chunk => { out += chunk.toString('utf8'); });
    child.on('error', reject);
    child.on('close', finish);
    setTimeout(() => { if (!settled) child.kill('SIGTERM'); }, expectLines ? 3200 : 1400);
  });
}

test('pull/push/record workers drive RUNNING tasks into terminal FAILED when no allowlisted ffmpeg exists', async () => {
  assert.ok(runWorker, 'helper present');
  const outputs = {};
  for (const workerFile of ['pull-worker.js', 'push-worker.js', 'record-worker.js']) {
    outputs[workerFile] = await runWorker(workerFile, true);
  }
  const rows = () => JSON.stringify({
    pull: pullTaskService.getTask(seeded.pull),
    push: pushTaskService.getTask(seeded.push),
    record: recordTaskService.getTask(seeded.record),
    stubHits: (globalThis.stubHits || []).reduce((acc, url) => { const key = url.split('?')[0]; acc[key] = (acc[key] || 0) + 1; return acc; }, {})
  }, null, 1);

  const failClosed = 'ffmpeg binary unavailable (fail-closed)';
  const pull = pullTaskService.getTask(seeded.pull);
  assert.equal(pull.runtime_state, 'FAILED', `pull task state: ${pull.last_error}\n${rows()}\n${outputs['pull-worker.js']}`);
  assert.ok(String(pull.last_error || '').includes(failClosed), `pull task error: ${pull.last_error}\n${rows()}`);

  const push = pushTaskService.getTask(seeded.push);
  assert.equal(push.runtime_state, 'FAILED', `push task state: ${push.last_error}\n${rows()}\n${outputs['push-worker.js']}`);
  assert.ok(String(push.last_error || '').includes(failClosed), `push task error: ${push.last_error}\n${rows()}`);

  const record = recordTaskService.getTask(seeded.record);
  assert.equal(record.runtime_state, 'FAILED', `record task state: ${record.last_error}\n${rows()}\n${outputs['record-worker.js']}`);
  assert.ok(String(record.last_error || '').includes(failClosed), `record task error: ${record.last_error}\n${rows()}`);
}, { timeout: 30000 });

test('transcode worker boots and exits cleanly on the same fresh database', async () => {
  const out = await runWorker('transcode-worker.js', false);
  assert.match(out, /lease acquired|lease acquisition failed|boot/i);
});
