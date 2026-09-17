const db = require('../database');
const pushTaskService = require('./push-task-service');
const bindingService = require('./transcode-binding-service');
const renditionService = require('./v3-rendition-service');
const capabilityService = require('./v3-capability-service');
const operationCore = require('./v3-operation-core');
const outPullService = require('./out-pull-service');

const SCENES = Object.freeze({
  LIVE_PLATFORM_PUSH: { mode: 'PUSH', transports: ['rtmp', 'rtmps'], default_transport: 'rtmp', default_protection: 'none' },
  CDN_PUSH: { mode: 'PUSH', transports: ['rtmp', 'rtmps'], default_transport: 'rtmp', default_protection: 'none' },
  SRT_NODE: { mode: 'PUSH', transports: ['srt'], default_transport: 'srt', default_protection: 'none' },
  CDN_ORIGIN: { mode: 'SERVE', transports: ['rtmp', 'http-flv', 'hls'], endpoint_protections: { rtmp: 'none', 'http-flv': 'none', hls: 'external-proxy' } },
  PARTNER_PULL: { mode: 'SERVE', transports: ['rtmp', 'http-flv'], endpoint_protections: { rtmp: 'access-grant', 'http-flv': 'access-grant' } },
  PLAYBACK_ACCESS: { mode: 'SERVE', transports: ['http-flv', 'hls'], endpoint_protections: { 'http-flv': 'access-grant', hls: 'external-proxy' } },
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
function createPushOutput(streamId, input = {}) {
  const stream = requireStream(streamId);
  const definition = validatePushDefinition(input);
  const targetUrl = String(input.destination?.target_url || input.target_url || '').trim();
  if (!targetUrl) throw new Error('PUSH target_url is required');

  const create = db.transaction(() => {
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
function configureServeOutput(streamId, input = {}) {
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
  const policy = outPullService.updatePolicy(stream.id, {
    endpoint_enabled: input.endpoint_enabled !== false,
    accepting_new_sessions: input.accepting_new_sessions !== false,
    require_grant: usesGrant,
    v3_metadata: {
      name: input.name || input.consumer?.label || 'SERVE Output',
      scene: sceneName,
      consumer_label: input.consumer?.label || null,
      advertised_transports: transports,
      endpoint_protections: endpointProtections
    }
  });
  return {
    id: `output:serve:${stream.id}`,
    stream_id: stream.id,
    scene: sceneName,
    transports,
    endpoint_protections: endpointProtections,
    policy,
    warnings,
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
  startOrStopServe
};
