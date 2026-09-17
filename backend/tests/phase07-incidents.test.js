const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'srs-manager-phase07-'));
process.env.DATA_DIR = dataDir;
const db = require('../database');
const incidents = require('../services/incident-service');
const health = require('../services/v3-health-service');

function baseWorkspace(name = 'phase07-room') {
  const streamId = Number(db.prepare('INSERT INTO streams (name, protocol) VALUES (?, ?)').run(name, 'rtmp').lastInsertRowid);
  const sessionId = Number(db.prepare("INSERT INTO sessions (stream_id, title, lifecycle_state, plan_snapshot_json) VALUES (?, 'Incident Session', 'ON_AIR', '{}')").run(streamId).lastInsertRowid);
  return {
    room: { legacy_stream_id: streamId },
    session: { legacy_session_id: sessionId, lifecycle_state: 'ON_AIR', outputs: [] },
    program: { id: `program:room:${streamId}`, state: 'LIVE' },
    renditions: [], outputs: [], evidence: { workers: {} }, capabilities: { runtime: {} },
    health: { status: 'NORMAL', reasons: [] }
  };
}
test('required single-output failure becomes a critical Incident without claiming Program loss', () => {
  const ws = baseWorkspace('incident-required');
  ws.outputs = [
    { id: 'output:push:1', mode: 'PUSH', desired_state: 'RUNNING', runtime_state: 'FAILED', media_ref: 'rendition:program' },
    { id: 'output:push:2', mode: 'PUSH', desired_state: 'RUNNING', runtime_state: 'RUNNING', media_ref: 'rendition:program' }
  ];
  ws.session.outputs = [
    { output_ref: 'output:push:1', importance: 'REQUIRED' },
    { output_ref: 'output:push:2', importance: 'OPTIONAL' }
  ];
  ws.health = { status: 'DEGRADED', reasons: [{ code: 'OUTPUT_RUNTIME_FAILED', severity: 'WARNING', message: 'push failed', subject_id: 'output:push:1', impact: 'single_output' }] };
  const synced = incidents.syncWorkspace(ws);
  assert.equal(synced.active.length, 1);
  assert.equal(synced.active[0].severity, 'CRITICAL');
  assert.deepEqual(synced.active[0].impact.output_ids, ['output:push:1']);
  assert.equal(synced.active[0].impact.can_still_broadcast, true);
});

test('acknowledge is not recovery and disappearance of the condition records RECOVERED', () => {
  const ws = baseWorkspace('incident-lifecycle');
  ws.outputs = [{ id: 'output:push:3', mode: 'PUSH', desired_state: 'RUNNING', runtime_state: 'FAILED' }];
  ws.health = { status: 'DEGRADED', reasons: [{ code: 'OUTPUT_RUNTIME_FAILED', severity: 'WARNING', message: 'push failed', subject_id: 'output:push:3', impact: 'single_output' }] };
  let incident = incidents.syncWorkspace(ws).active[0];
  incident = incidents.acknowledge(incident.id, ws.room.legacy_stream_id, 'operator');
  assert.equal(incident.status, 'ACKNOWLEDGED');
  assert.equal(incidents.syncWorkspace(ws).active[0].status, 'ACKNOWLEDGED');
  ws.health = { status: 'NORMAL', reasons: [] };
  const after = incidents.syncWorkspace(ws);
  assert.equal(after.active.length, 0);
  const recovered = after.recent.find(item => item.id === incident.id);
  assert.equal(recovered.status, 'RECOVERED');
  const events = incidents.listEvents(incident.id).map(event => event.event_type);
  assert.deepEqual(events, ['OPENED', 'ACKNOWLEDGED', 'RECOVERED']);
});

test('rendition and storage facts map to limited business impact', () => {
  const ws = baseWorkspace('incident-impact');
  ws.renditions = [{ id: 'rendition:bad', kind: 'TRANSCODE', desired_state: 'RUNNING', runtime_state: 'FAILED', observed: { online: false } }];
  ws.outputs = [
    { id: 'output:push:4', mode: 'PUSH', desired_state: 'RUNNING', runtime_state: 'RUNNING', media_ref: 'rendition:bad', evidence: { local: { freshness: 'FRESH' } } },
    { id: 'output:push:5', mode: 'PUSH', desired_state: 'RUNNING', runtime_state: 'RUNNING', media_ref: 'rendition:other', evidence: { local: { freshness: 'FRESH' } } },
    { id: 'output:record:1', mode: 'RECORD', desired_state: 'RUNNING', runtime_state: 'RECORDING', media_ref: 'rendition:other' }
  ];
  ws.evidence.workers = { push: { available: true }, transcode: { available: true }, record: { available: true }, pull: { available: true } };
  ws.capabilities.runtime = { record: { available: true, storage: { low_space: true } } };
  ws.health = health.evaluateWorkspace(ws);
  const derived = incidents.deriveIncidents(ws);
  const renditionIncident = derived.find(item => item.code === 'RENDITION_RUNTIME_FAILED');
  assert.deepEqual(renditionIncident.impact.output_ids, ['output:push:4']);
  assert.equal(derived.find(item => item.code === 'RECORD_STORAGE_LOW').category, 'RESOURCE');
});

test.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
