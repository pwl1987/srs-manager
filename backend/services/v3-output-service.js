const db = require('../database');
const crypto = require('crypto');
const pushTaskService = require('./push-task-service');
const bindingService = require('./transcode-binding-service');
const renditionService = require('./v3-rendition-service');
const capabilityService = require('./v3-capability-service');
const operationCore = require('./v3-operation-core');
const outPullService = require('./out-pull-service');
const recordTaskService = require('./record-task-service');

const SCENES = Object.freeze({
  LIVE_PLATFORM_PUSH: { mode: 'PUSH', transports: ['rtmp', 'rtmps'], default_transport: 'rtmp', default_protection: 'none' },
  CDN_PUSH: { mode: 'PUSH', transports: ['rtmp', 'rtmps'], default_transport: 'rtmp', default_protection: 'none' },
  SRT_NODE: { mode: 'PUSH', transports: ['srt'], default_transport: 'srt', default_protection: 'none' },
  CDN_ORIGIN: { mode: 'SERVE', transports: ['rtmp', 'http-flv', 'hls'], endpoint_protections: { rtmp: 'none', 'http-flv': 'none', hls: 'external-proxy' } },
  PARTNER_PULL: { mode: 'SERVE', transports: ['rtmp', 'http-flv'], endpoint_protections: { rtmp: 'access-grant', 'http-flv': 'access-grant' } },
  PLAYBACK_ACCESS: { mode: 'SERVE', transports: ['http-flv', 'hls'], endpoint_protections: { 'http-flv': 'access-grant', hls: 'external-proxy' } },
  LOCAL_RECORD: { mode: 'RECORD', formats: ['mp4', 'ts', 'audio'], default_format: 'mp4', default_protection: 'storage-policy' },
  PROFESSIONAL: { mode: null, transports: [], default_protection: null }
});

function requireStream(streamId) {
  const stream = db.prepare('SELECT id, name FROM streams WHERE id = ?').get(Number(streamId));
  if (!stream) throw new Error('Stream not found');
  return stream;
}

function sceneDefinition(scene) {
  return SCENES[String(scene || 'PROFESSIONAL').toUpperCase()] || null;
}
function validatePushDefinition(input = {}) {
  const transport = String(input.transport || '').toLowerCase();
  if (!capabilityService.PRODUCT.PUSH.transports.includes(transport)) {
    throw new Error(`Unsupported PUSH transport: ${transport || 'empty'}`);
  }
  const protection = String(input.protection || 'none').toLowerCase();
  const allowedProtection = capabilityService.PROTECTION[`PUSH:${transport}`] || [];
  if (!allowedProtection.includes(protection)) {
    throw new Error(`Unsupported protection for PUSH ${transport}: ${protection}`);
  }
  const scene = sceneDefinition(input.scene);
  if (!scene) throw new Error('Unknown output scene');
  if (scene.mode && scene.mode !== 'PUSH') throw new Error(`${input.scene} is not a PUSH scene`);
  if (scene.transports.length && !scene.transports.includes(transport)) {
    throw new Error(`${input.scene} does not support ${transport}`);
  }
  const destinationKind = String(input.destination?.kind || 'CUSTOM').toUpperCase();
  const destination = capabilityService.getCapabilities().destination[destinationKind] || { state: 'UNKNOWN' };
  if (destination.state === 'UNAVAILABLE') throw new Error(`${destinationKind} integration is unavailable`);
  return { transport, protection, scene: String(input.scene || 'PROFESSIONAL').toUpperCase(), destinationKind };
}

function processingBinding(streamId, processing = {}) {
  const mode = String(processing.mode || 'PASSTHROUGH').toUpperCase();
  if (mode === 'PASSTHROUGH') return { binding: null, reused: true, signature: null };
  if (mode !== 'RENDITION' && mode !== 'TRANSCODE') throw new Error(`Unsupported processing mode: ${mode}`);
  if (!processing.template_id) throw new Error('template_id is required for a Rendition');
  return renditionService.ensureRendition(streamId, processing.template_id);
}

// ---------------------------------------------------------------------------
// PHASE-09-FIX-04 Output creation idempotency (lifecycle correction).
//
// POST /v3/rooms/:roomId/outputs accepts an Idempotency-Key. The server
// derives a SHA-256 fingerprint from the NORMALIZED create request (the same
// defaults the create path applies) and stores key + fingerprint + created
// subject — never the payload, whose target URLs are credential-bearing.
//
// Frozen state machine — a key represents ONE creation intent and its FIRST
// result; it is never a rebuild key:
//   NEW                        → CREATED (resource + mapping, one transaction)
//   CREATED + same fingerprint → REPLAY  (pure read: zero write side effects)
//   CREATED + new fingerprint  → 409 CONFLICT (first resource untouched)
//   subject deleted            → 409 RESULT_GONE (mapping kept as tombstone)
//   SERVE singleton superseded → 409 RESULT_SUPERSEDED, decided by the
//                                room's persistent (epoch, generation)
//                                revision: every control-plane write (a new
//                                key's configure, serve start/stop, the V2
//                                policy route) gets a strictly greater
//                                generation from serve_policy_revisions — an
//                                authority that SURVIVES deletion of the
//                                policy row — and a policy created after
//                                absence gets a new epoch (a new instance).
//                                A key replays only while BOTH the instance
//                                and the generation of its first write are
//                                still current: instance changed (the old
//                                result died and was replaced by a recreated
//                                policy, even with identical fields) is
//                                RESULT_GONE; same instance with a later
//                                write is RESULT_SUPERSEDED. Fields that
//                                later coincide again (an A-B-A
//                                reconfiguration, a delete→recreate cycle)
//                                do NOT restore replay rights; only the key
//                                of the LAST real write owns the current
//                                revision.
// The mapping NEVER rebinds to another subject; a new business creation
// requires a NEW Idempotency-Key. "Is this the first creation?" is decided
// INSIDE the same BEGIN IMMEDIATE transaction as the resource create and the
// mapping insert, so racing callers serialize on the write lock and the
// loser replays — the (room_id, key) unique index is a fail-closed last
// line of defense, never the correctness mechanism.
// ---------------------------------------------------------------------------

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function normalizedProcessing(processing = {}) {
  const mode = String(processing.mode || 'PASSTHROUGH').toUpperCase();
  return {
    processing_mode: mode,
    processing_template_id: mode === 'PASSTHROUGH' ? null : String(processing.template_id || '')
  };
}

function pushRequestFingerprint(input, definition, targetUrl) {
  return sha256Hex(JSON.stringify({
    mode: 'PUSH',
    name: String(input.name || '').trim(),
    scene: definition.scene,
    transport: definition.transport,
    protection: definition.protection,
    destination_kind: definition.destinationKind,
    target_url: targetUrl,
    ...normalizedProcessing(input.processing)
  }));
}

function recordRequestFingerprint(input, sceneName, format) {
  const retention = input.storage?.retention_days;
  return sha256Hex(JSON.stringify({
    mode: 'RECORD',
    name: String(input.name || '').trim(),
    scene: sceneName,
    format,
    audio_format: String(input.audio_format || '').toLowerCase() || null,
    ...normalizedProcessing(input.processing),
    storage_subdir: input.storage?.subdir || '',
    filename_prefix: input.storage?.filename_prefix || null,
    segment_seconds: Number(input.storage?.segment_seconds ?? 6),
    retention_days: retention === undefined || retention === null ? null : Number(retention)
  }));
}

function serveRequestFingerprint(input, sceneName, transports, endpointProtections) {
  const ordered = [...transports].sort();
  return sha256Hex(JSON.stringify({
    mode: 'SERVE',
    name: String(input.name || input.consumer?.label || '').trim(),
    scene: sceneName,
    transports: ordered,
    endpoint_protections: Object.fromEntries(ordered.map(transport => [transport, endpointProtections[transport]])),
    endpoint_enabled: input.endpoint_enabled === true,
    accepting_new_sessions: input.accepting_new_sessions !== false
  }));
}

// Returns the recorded mapping row when the key was seen before, null when the
// key is new. A same-key/different-fingerprint replay is a conflict — the
// first resource must never be handed out for a different request. Called
// INSIDE the creation transaction: the caller has the write lock while it
// decides, so the answer cannot go stale under a racing create.
function recordedOutputIdempotency(roomId, idempotencyKey, fingerprint) {
  if (!idempotencyKey) return null;
  const row = db.prepare('SELECT * FROM output_idempotency WHERE room_id = ? AND idempotency_key = ?').get(Number(roomId), idempotencyKey);
  if (!row) return null;
  if (row.request_fingerprint !== fingerprint) {
    const error = new Error(`Idempotency-Key was already used for a different ${String(row.output_type).toUpperCase()} Output create request in this Room`);
    error.idempotencyConflict = true;
    throw error;
  }
  return row;
}

// Insert inside the SAME transaction as the resource creation. A plain
// INSERT, deliberately: the key is proven new by the in-transaction check,
// and the (room_id, idempotency_key) unique index must ABORT a concurrent
// duplicate instead of silently rebinding the key to a second subject.
// Recorded mappings are immutable — there is no update path. For SERVE the
// mapping pins BOTH the policy instance (result_epoch) and the generation
// (result_revision) this key's first write produced (NULL for task-backed
// outputs, whose subject identity is the task row itself).
function recordOutputIdempotency(roomId, idempotencyKey, fingerprint, outputType, subjectId, canonicalOutputId, resultRevision = null, resultEpoch = null) {
  if (!idempotencyKey) return;
  db.prepare(`
    INSERT INTO output_idempotency (room_id, idempotency_key, request_fingerprint, output_type, subject_id, output_id, result_revision, result_epoch)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(Number(roomId), idempotencyKey, fingerprint, outputType, Number(subjectId), canonicalOutputId, resultRevision === null ? null : Number(resultRevision), resultEpoch === null ? null : Number(resultEpoch));
}

// Terminal error: the key's recorded subject no longer exists. The mapping
// stays as tombstone evidence; recreating requires a NEW key.
function resultGoneError(outputLabel) {
  const error = new Error(`The ${outputLabel} Output this Idempotency-Key created has been deleted; creating again requires a new Idempotency-Key`);
  error.idempotencyResultGone = true;
  return error;
}

function supersededError() {
  const error = new Error('The SERVE configuration this Idempotency-Key created has since been changed by another request; configuring again requires a new Idempotency-Key');
  error.idempotencySuperseded = true;
  return error;
}

// A SERVE mapping recorded before generation tracking existed (a pre-FIX-05
// database upgraded in place) cannot PROVE which instance or revision its
// result belongs to. Fail closed — never guess the key back into replay
// eligibility.
function unprovenRevisionError() {
  const error = new Error('The SERVE configuration this Idempotency-Key created predates revision tracking and its currency cannot be proven; configuring again requires a new Idempotency-Key');
  error.idempotencySuperseded = true;
  return error;
}

// Task-backed replay (PUSH/RECORD): answer with the recorded task. A subject
// deleted since creation is a terminal RESULT_GONE — the key is a tombstone,
// never a rebuild key, and the mapping must not be pointed anywhere else.
function replayTaskOutput(recorded, taskService) {
  const task = taskService.getTask(Number(recorded.subject_id));
  if (!task) throw resultGoneError(String(recorded.output_type || 'output').toUpperCase());
  return { task, idempotent_replay: true };
}

function createPushOutput(streamId, input = {}, { idempotency_key = null } = {}) {
  const stream = requireStream(streamId);
  const definition = validatePushDefinition(input);
  const targetUrl = String(input.destination?.target_url || input.target_url || '').trim();
  if (!targetUrl) throw new Error('PUSH target_url is required');

  const fingerprint = pushRequestFingerprint(input, definition, targetUrl);
  // The first-creation decision, the task create and the key mapping are ONE
  // BEGIN IMMEDIATE unit: a racing caller holds off until this transaction
  // commits, then re-reads the mapping inside its own transaction and
  // replays. No check happens outside the write lock.
  const create = db.transaction(() => {
    const recorded = recordedOutputIdempotency(stream.id, idempotency_key, fingerprint);
    if (recorded) return replayTaskOutput(recorded, pushTaskService);
    const rendition = processingBinding(stream.id, input.processing || {});
    const task = pushTaskService.createTask({
      stream_id: stream.id,
      source_binding_id: rendition.binding?.id || null,
      target_type: input.destination?.label || input.name || definition.destinationKind,
      target_url: targetUrl,
      enabled: 0,
      v3_metadata: {
        name: input.name || input.destination?.label || `PUSH ${definition.transport.toUpperCase()}`,
        scene: definition.scene,
        protection: definition.protection,
        destination_kind: definition.destinationKind,
        destination_label: input.destination?.label || null
      }
    });
    recordOutputIdempotency(stream.id, idempotency_key, fingerprint, 'push', task.id, outputId(task.id));
    return { task, rendition };
  });
  return create.immediate();
}

function outputId(taskId) {
  return `output:push:${Number(taskId)}`;
}

function parsePushOutputId(value) {
  const match = String(value || '').match(/^output:push:(\d+)$/);
  return match ? Number(match[1]) : null;
}
function startOrStopPush(taskId, desiredState, { idempotency_key, requested_by = null } = {}) {
  const task = pushTaskService.getTask(taskId);
  if (!task) throw new Error('Output not found');
  if (task.execution_mode !== 'managed_worker') throw new Error('Legacy Dynamic Forward cannot use V3 Output operations');
  const desired = String(desiredState || '').toUpperCase();
  const type = desired === 'RUNNING' ? 'V3_OUTPUT_START' : desired === 'STOPPED' ? 'V3_OUTPUT_STOP' : null;
  if (!type) throw new Error('Invalid output desired state');

  const created = operationCore.createOrReuse({
    type,
    subject_type: 'forward_task',
    subject_id: task.id,
    idempotency_key,
    requested_by,
    payload: { output_id: outputId(task.id), desired_state: desired }
  });
  if (created.conflict || created.reused) return created;

  try {
    pushTaskService.setDesiredState(task.id, desired);
    if (task.source_binding_id) renditionService.reconcileDesiredState(task.source_binding_id);
    return { operation: operationCore.transition(created.operation.id, 'VERIFYING'), reused: false };
  } catch (error) {
    return { operation: operationCore.transition(created.operation.id, 'FAILED', { error: error.message }), reused: false };
  }
}

function reconcilePushOperation(operation) {
  if (!operation || operation.subject_type !== 'forward_task') return operation;
  if (!['V3_OUTPUT_START', 'V3_OUTPUT_STOP'].includes(operation.type)) return operation;
  if (['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(operation.phase)) return operation;
  const task = pushTaskService.getTask(operation.subject_id);
  if (!task) return operationCore.transition(operation.id, 'FAILED', { error: 'Output no longer exists' });
  if (operation.type === 'V3_OUTPUT_START') {
    if (task.runtime_state === 'RUNNING') {
      return operationCore.transition(operation.id, 'SUCCEEDED', { result: { output_id: outputId(task.id), runtime_state: task.runtime_state } });
    }
    if (task.runtime_state === 'FAILED') {
      return operationCore.transition(operation.id, 'FAILED', { error: task.last_error || 'Output failed to start' });
    }
    return operation;
  }

  if (task.runtime_state === 'STOPPED') {
    return operationCore.transition(operation.id, 'SUCCEEDED', { result: { output_id: outputId(task.id), runtime_state: task.runtime_state } });
  }
  return operation;
}

function deletePushOutput(taskId) {
  const task = pushTaskService.getTask(taskId);
  if (!task) return null;
  const bindingId = task.source_binding_id;
  const result = pushTaskService.deleteTask(task.id);
  let rendition_deleted = false;
  if (bindingId) {
    const refs = db.prepare('SELECT COUNT(*) AS count FROM forward_tasks WHERE source_binding_id = ?').get(bindingId).count;
    const binding = bindingService.getBinding(bindingId);
    if (!refs && binding && binding.desired_state === 'STOPPED' && binding.runtime_state === 'STOPPED') {
      bindingService.deleteBinding(bindingId);
      rendition_deleted = true;
    }
  }
  return { ...result, rendition_deleted };
}
// Order-insensitive canonical JSON: comparing the stored sanitized metadata
// with the expected first-creation metadata must not depend on key order.
function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value === undefined ? null : value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value)
    .filter(key => value[key] !== undefined)
    .sort()
    .map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(',')}}`;
}

function parseStoredMetadata(value) {
  try { return JSON.parse(value); } catch { return null; }
}

// SERVE replay must be side-effect free: the room's singleton policy row IS
// the key's recorded result. Replay legality is decided by the room's
// persistent (epoch, generation) revision, allocated from
// serve_policy_revisions — an authority that survives policy-row deletion:
//   policy row missing                     → RESULT_GONE
//   instance (epoch) changed               → RESULT_GONE — the key's first
//                                             result died with the deleted
//                                             policy; the recreated row is a
//                                             NEW instance even when every
//                                             field is identical
//   same epoch, later generation           → RESULT_SUPERSEDED — a stale key
//                                             must not answer or overwrite
//                                             the newer configuration
//   same epoch + same generation           → pure 200 replay, zero writes
// Fields that later coincide again (A-B-A, delete→recreate) never restore
// replay rights; only the key of the LAST real write owns the current
// revision. A mapping without a provable epoch/revision (pre-tracking
// upgrade) replays fail-closed. The field-level semantic comparison below is
// an extra fail-closed guard, not the supersession authority. Either way
// nothing is written and the mapping is untouched.
function replayServeOutput(recorded, expectedFlags, expectedMetadata) {
  const row = db.prepare('SELECT endpoint_enabled, accepting_new_sessions, require_grant, v3_metadata_json, generation, epoch FROM out_pull_policies WHERE stream_id = ?').get(Number(recorded.subject_id));
  if (!row) throw resultGoneError('SERVE');
  const recordedRevision = recorded.result_revision === null || recorded.result_revision === undefined
    ? null
    : Number(recorded.result_revision);
  const recordedEpoch = recorded.result_epoch === null || recorded.result_epoch === undefined
    ? null
    : Number(recorded.result_epoch);
  if (!Number.isInteger(recordedRevision) || recordedRevision < 1 || !Number.isInteger(recordedEpoch) || recordedEpoch < 1) throw unprovenRevisionError();
  if (Number(row.epoch) !== recordedEpoch) throw resultGoneError('SERVE');
  if (Number(row.generation) !== recordedRevision) throw supersededError();
  const unchanged = Boolean(row.endpoint_enabled) === expectedFlags.endpoint_enabled
    && Boolean(row.accepting_new_sessions) === expectedFlags.accepting_new_sessions
    && Boolean(row.require_grant) === expectedFlags.require_grant
    && row.v3_metadata_json
    && canonicalJson(parseStoredMetadata(row.v3_metadata_json)) === canonicalJson(expectedMetadata);
  if (!unchanged) throw supersededError();
  return outPullService.getPolicy(recorded.subject_id);
}

function configureServeOutput(streamId, input = {}, { idempotency_key = null } = {}) {
  const stream = requireStream(streamId);
  const sceneName = String(input.scene || 'PROFESSIONAL').toUpperCase();
  const scene = sceneDefinition(sceneName);
  if (!scene) throw new Error('Unknown output scene');
  if (scene.mode && scene.mode !== 'SERVE') throw new Error(`${sceneName} is not a SERVE scene`);
  const transports = Array.isArray(input.transports) && input.transports.length
    ? [...new Set(input.transports.map(value => String(value).toLowerCase()))]
    : (scene.transports.length ? scene.transports : ['rtmp', 'http-flv', 'hls']);
  const endpointProtections = {};
  for (const transport of transports) {
    if (!capabilityService.PRODUCT.SERVE.transports.includes(transport)) throw new Error(`Unsupported SERVE transport: ${transport}`);
    const protection = String(input.endpoint_protections?.[transport] || scene.endpoint_protections?.[transport] || input.protection || 'none').toLowerCase();
    const allowed = capabilityService.PROTECTION[`SERVE:${transport}`] || [];
    if (!allowed.includes(protection)) throw new Error(`Unsupported protection for SERVE ${transport}: ${protection}`);
    if (['rtmp', 'http-flv'].includes(transport) && !['none', 'access-grant'].includes(protection)) {
      throw new Error(`Current Runtime cannot enforce ${protection} on ${transport}`);
    }
    if (transport === 'hls' && !['none', 'external-proxy'].includes(protection)) {
      throw new Error(`Direct SRS HLS cannot enforce ${protection}; use external-proxy or none`);
    }
    endpointProtections[transport] = protection;
  }
  const hookProtections = transports.filter(t => ['rtmp', 'http-flv'].includes(t)).map(t => endpointProtections[t]);
  const usesGrant = hookProtections.includes('access-grant');
  if (usesGrant && hookProtections.some(p => p !== 'access-grant')) {
    throw new Error('RTMP and HTTP-FLV share one admission policy and cannot mix open/access-grant in current Runtime');
  }
  const warnings = [];
  if (transports.includes('hls') && endpointProtections.hls === 'none') {
    warnings.push({ code: 'HLS_DIRECT_UNPROTECTED', message: 'Direct SRS HLS bypasses current on_play admission and is intentionally unprotected.' });
  }
  // Same key + same normalized request replays the FIRST configuration with
  // ZERO write side effects — no updatePolicy, not even an updated_at touch.
  // SERVE is the room's singleton output: the replay is legal only while the
  // policy row's generation is still the one this key's first write produced;
  // a newer write — another key, serve start/stop — permanently supersedes
  // the old key, and a newer configuration must never be rolled back by a
  // stale retry.
  const fingerprint = serveRequestFingerprint(input, sceneName, transports, endpointProtections);
  const metadata = {
    name: input.name || input.consumer?.label || 'SERVE Output',
    scene: sceneName,
    consumer_label: input.consumer?.label || null,
    advertised_transports: transports,
    endpoint_protections: endpointProtections
  };
  const flags = {
    endpoint_enabled: input.endpoint_enabled === true,
    accepting_new_sessions: input.accepting_new_sessions !== false,
    require_grant: usesGrant
  };
  const write = db.transaction(() => {
    const recorded = recordedOutputIdempotency(stream.id, idempotency_key, fingerprint);
    if (recorded) {
      return { policy: replayServeOutput(recorded, flags, metadata), replay: true };
    }
    const policy = outPullService.updatePolicy(stream.id, { ...flags, v3_metadata: metadata });
    // Read back inside the SAME transaction: this is the (epoch, generation)
    // this key's first write produced — no later write can slip between
    // updatePolicy and the mapping insert under the BEGIN IMMEDIATE write
    // lock.
    const revision = db.prepare('SELECT epoch, generation FROM out_pull_policies WHERE stream_id = ?').get(stream.id);
    recordOutputIdempotency(stream.id, idempotency_key, fingerprint, 'serve', stream.id, `output:serve:${stream.id}`, revision.generation, revision.epoch);
    return { policy, replay: false };
  });
  const { policy, replay } = write.immediate();
  return {
    id: `output:serve:${stream.id}`,
    stream_id: stream.id,
    scene: sceneName,
    transports,
    endpoint_protections: endpointProtections,
    policy,
    warnings,
    ...(replay ? { idempotent_replay: true } : {}),
    runtime_boundary: {
      admission_shared_by: ['rtmp', 'http-flv'],
      direct_hls_requires_external_boundary_for_protection: true,
      per_endpoint_disable: false
    }
  };
}

function setServeDesiredState(streamId, desiredState) {
  requireStream(streamId);
  const desired = String(desiredState || '').toUpperCase();
  if (!['RUNNING', 'STOPPED'].includes(desired)) throw new Error('Invalid SERVE desired state');
  return outPullService.updatePolicy(streamId, { endpoint_enabled: desired === 'RUNNING' });
}

function serveOutputId(streamId) {
  return `output:serve:${Number(streamId)}`;
}

function parseServeOutputId(value) {
  const match = String(value || '').match(/^output:serve:(\d+)$/);
  return match ? Number(match[1]) : null;
}

function startOrStopServe(streamId, desiredState, { idempotency_key, requested_by = null } = {}) {
  requireStream(streamId);
  const desired = String(desiredState || '').toUpperCase();
  const type = desired === 'RUNNING' ? 'V3_SERVE_ENABLE' : desired === 'STOPPED' ? 'V3_SERVE_DISABLE' : null;
  if (!type) throw new Error('Invalid SERVE desired state');
  const created = operationCore.createOrReuse({
    type, subject_type: 'out_pull_policy', subject_id: Number(streamId), idempotency_key, requested_by,
    payload: { output_id: serveOutputId(streamId), desired_state: desired }
  });
  if (created.conflict || created.reused) return created;
  try {
    operationCore.transition(created.operation.id, 'RUNNING');
    const policy = setServeDesiredState(streamId, desired);
    return { operation: operationCore.transition(created.operation.id, 'SUCCEEDED', { result: { output_id: serveOutputId(streamId), endpoint_enabled: policy.endpoint_enabled } }), reused: false };
  } catch (error) {
    return { operation: operationCore.transition(created.operation.id, 'FAILED', { error: error.message }), reused: false };
  }
}


function recordOutputId(taskId) { return `output:record:${Number(taskId)}`; }
function parseRecordOutputId(value) {
  const match = String(value || '').match(/^output:record:(\d+)$/);
  return match ? Number(match[1]) : null;
}
function createRecordOutput(streamId, input = {}, { idempotency_key = null } = {}) {
  const stream = requireStream(streamId);
  const sceneName = String(input.scene || 'PROFESSIONAL').toUpperCase();
  const scene = sceneDefinition(sceneName);
  if (!scene) throw new Error('Unknown output scene');
  if (scene.mode && scene.mode !== 'RECORD') throw new Error(`${sceneName} is not a RECORD scene`);
  const format = String(input.format || scene.default_format || 'mp4').toLowerCase();
  if (!capabilityService.PRODUCT.RECORD.formats.includes(format)) throw new Error(`Unsupported RECORD format: ${format}`);

  const fingerprint = recordRequestFingerprint(input, sceneName, format);
  // Same atomic unit as PUSH: check → create → mapping inside one BEGIN
  // IMMEDIATE transaction (see the state machine note above).
  const create = db.transaction(() => {
    const recorded = recordedOutputIdempotency(stream.id, idempotency_key, fingerprint);
    if (recorded) return replayTaskOutput(recorded, recordTaskService);
    const rendition = processingBinding(stream.id, input.processing || {});
    const task = recordTaskService.createTask({
      stream_id: stream.id,
      source_binding_id: rendition.binding?.id || null,
      name: input.name || `Local ${format.toUpperCase()} recording`,
      format,
      audio_format: input.audio_format || null,
      subdir: input.storage?.subdir || '',
      filename_prefix: input.storage?.filename_prefix || null,
      segment_seconds: input.storage?.segment_seconds ?? 6,
      retention_days: input.storage?.retention_days ?? null
    });
    recordOutputIdempotency(stream.id, idempotency_key, fingerprint, 'record', task.id, recordOutputId(task.id));
    return { task, rendition };
  });
  return create.immediate();
}
function startOrStopRecord(taskId, desiredState, { idempotency_key, requested_by = null } = {}) {
  const task = recordTaskService.getTask(taskId);
  if (!task) throw new Error('Recording output not found');
  const desired = String(desiredState || '').toUpperCase();
  const type = desired === 'RUNNING' ? 'V3_RECORD_START' : desired === 'STOPPED' ? 'V3_RECORD_STOP' : null;
  if (!type) throw new Error('Invalid recording desired state');
  // A Worker can reach the requested runtime state before the console reads
  // the operation resource. Reconcile that completed fact before rejecting
  // the opposite action as a conflict.
  const active = operationCore.activeForSubject('record_task', task.id);
  if (active) reconcileRecordOperation(active);
  const created = operationCore.createOrReuse({ type, subject_type: 'record_task', subject_id: task.id, idempotency_key, requested_by, payload: { output_id: recordOutputId(task.id), desired_state: desired } });
  if (created.conflict || created.reused) return created;
  try {
    recordTaskService.setDesiredState(task.id, desired);
    return { operation: operationCore.transition(created.operation.id, 'VERIFYING'), reused: false };
  } catch (error) {
    return { operation: operationCore.transition(created.operation.id, 'FAILED', { error: error.message }), reused: false };
  }
}
function reconcileRecordOperation(operation) {
  if (!operation || operation.subject_type !== 'record_task') return operation;
  if (!['V3_RECORD_START','V3_RECORD_STOP'].includes(operation.type)) return operation;
  if (['SUCCEEDED','FAILED','CANCELLED'].includes(operation.phase)) return operation;
  const task = recordTaskService.getTask(operation.subject_id);
  if (!task) return operationCore.transition(operation.id, 'FAILED', { error: 'Recording output no longer exists' });
  if (operation.type === 'V3_RECORD_START') {
    if (task.runtime_state === 'RECORDING') return operationCore.transition(operation.id, 'SUCCEEDED', { result: { output_id: recordOutputId(task.id), runtime_state: task.runtime_state } });
    if (task.runtime_state === 'FAILED') return operationCore.transition(operation.id, 'FAILED', { error: task.last_error || 'Recording failed to start' });
    return operation;
  }
  if (['COMPLETE','STOPPED'].includes(task.runtime_state)) return operationCore.transition(operation.id, 'SUCCEEDED', { result: { output_id: recordOutputId(task.id), runtime_state: task.runtime_state } });
  if (task.runtime_state === 'FAILED') return operationCore.transition(operation.id, 'FAILED', { error: task.last_error || 'Recording failed to stop cleanly' });
  return operation;
}

function listScenes() {
  return Object.entries(SCENES).map(([id, value]) => ({ id, ...value }));
}

module.exports = {
  SCENES,
  listScenes,
  validatePushDefinition,
  createPushOutput,
  configureServeOutput,
  setServeDesiredState,
  startOrStopPush,
  reconcilePushOperation,
  deletePushOutput,
  outputId,
  parsePushOutputId,
  serveOutputId,
  parseServeOutputId,
  startOrStopServe,
  createRecordOutput, recordOutputId, parseRecordOutputId, startOrStopRecord, reconcileRecordOperation
};
