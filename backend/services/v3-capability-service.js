const pushTaskService = require('./push-task-service');
const pullTaskService = require('./pull-task-service');
const transcodeBindingService = require('./transcode-binding-service');
const wangsuService = require('./wangsu');
const sourcePreviewService = require('./source-preview-service');

const PRODUCT = Object.freeze({
  PUSH: { transports: ['rtmp', 'rtmps', 'srt'] },
  SERVE: { transports: ['rtmp', 'http-flv', 'hls'] },
  RECORD: { formats: ['ts', 'mp4', 'audio'] }
});

const PROTECTION = Object.freeze({
  'PUSH:rtmp': ['none', 'url-credential', 'token', 'timestamp-signature', 'provider-credential'],
  'PUSH:rtmps': ['none', 'url-credential', 'token', 'timestamp-signature', 'provider-credential'],
  'PUSH:srt': ['none', 'passphrase'],
  'SERVE:rtmp': ['none', 'access-grant', 'token', 'ip-allowlist'],
  'SERVE:http-flv': ['none', 'access-grant', 'token', 'ip-allowlist'],
  'SERVE:hls': ['none', 'timestamp-signature', 'hotlink', 'ip-allowlist', 'external-proxy'],
  'RECORD:ts': ['storage-policy'],
  'RECORD:mp4': ['storage-policy'],
  'RECORD:audio': ['storage-policy']
});

function runtimeSnapshot(workspace = null) {
  const workers = workspace?.evidence?.workers || null;
  return {
    pull_worker: workers?.pull || pullTaskService.getWorkerHealth(),
    push_worker: workers?.push || pushTaskService.getWorkerHealth(),
    transcode_worker: workers?.transcode || transcodeBindingService.getWorkerHealth(),
    srs_observed: workspace ? workspace.evidence?.srs?.available === true : null,
    preview: { hls_secure_proxy: true, http_flv_secure_proxy: true, preferred: 'http-flv', fallback: 'hls', source_preview: sourcePreviewService.capability() },
    record: { available: false, reason_code: 'PHASE_05_NOT_IMPLEMENTED' }
  };
}

function destinationSnapshot() {
  return {
    CUSTOM: { state: 'UNKNOWN', override_allowed: true },
    WANGSU: {
      state: wangsuService.isConfigured() ? 'AVAILABLE' : 'UNAVAILABLE',
      override_allowed: false,
      evidence: ['remote_live_state', 'remote_bitrate', 'remote_viewers']
    }
  };
}

function getCapabilities(workspace = null) {
  return {
    layers: ['PRODUCT', 'RUNTIME', 'DESTINATION'],
    product: PRODUCT,
    protections: PROTECTION,
    runtime: runtimeSnapshot(workspace),
    destination: destinationSnapshot(),
    rule: 'available = product ∩ runtime ∩ destination'
  };
}

function invalid(reason_code, message, alternatives = []) {
  return { valid: false, reason_code, message, alternatives, override_allowed: false };
}

function validateOutput(input = {}, workspace = null) {
  const mode = String(input.mode || '').toUpperCase();
  const transport = String(input.transport_or_format || input.transport || input.format || '').toLowerCase();
  const protection = String(input.protection || 'none').toLowerCase();
  const destinationKind = String(input.destination?.kind || input.destination || 'CUSTOM').toUpperCase();
  const caps = getCapabilities(workspace);
  const product = PRODUCT[mode];
  if (!product) return invalid('PRODUCT_MODE_UNSUPPORTED', `Unsupported output mode: ${mode || 'empty'}`);
  const allowed = product.transports || product.formats || [];
  if (!allowed.includes(transport)) {
    return invalid('PRODUCT_TRANSPORT_UNSUPPORTED', `${mode} does not support ${transport || 'empty'}`, allowed);
  }
  if (!(PROTECTION[`${mode}:${transport}`] || []).includes(protection)) {
    return invalid('PROTECTION_UNSUPPORTED', `${protection} is not supported for ${mode} ${transport}`, PROTECTION[`${mode}:${transport}`] || []);
  }
  if (mode === 'PUSH' && !caps.runtime.push_worker?.available) {
    return invalid('RUNTIME_PUSH_WORKER_UNAVAILABLE', 'Managed Push Worker is unavailable');
  }
  if (mode === 'SERVE' && ['rtmp', 'http-flv'].includes(transport) && !['none', 'access-grant'].includes(protection)) {
    return invalid('RUNTIME_PROTECTION_UNAVAILABLE', `Current Runtime cannot enforce ${protection} on ${transport}`, ['none', 'access-grant']);
  }
  if (mode === 'SERVE' && transport === 'hls' && !['none', 'external-proxy'].includes(protection)) {
    return invalid('RUNTIME_PROTECTION_UNAVAILABLE', `Direct SRS HLS cannot enforce ${protection}`, ['none', 'external-proxy']);
  }
  if (mode === 'SERVE' && workspace && caps.runtime.srs_observed === false) {
    return invalid('RUNTIME_SRS_UNAVAILABLE', 'SRS runtime is not currently observable');
  }
  if (mode === 'RECORD' && !caps.runtime.record.available) {
    return invalid('RUNTIME_RECORD_UNAVAILABLE', 'Recording runtime is not implemented before Phase 05');
  }
  const destination = caps.destination[destinationKind] || { state: 'UNKNOWN', override_allowed: true };
  if (destination.state === 'UNAVAILABLE') {
    return invalid('DESTINATION_UNAVAILABLE', `${destinationKind} integration is unavailable`);
  }
  const warnings = [];
  if (destination.state === 'UNKNOWN') warnings.push({ code: 'DESTINATION_CAPABILITY_UNKNOWN', message: 'Destination compatibility is unknown and must be verified by the operator.' });
  if (mode === 'SERVE' && transport === 'hls' && protection === 'external-proxy') {
    warnings.push({ code: 'HLS_EXTERNAL_PROTECTION_REQUIRED', message: 'Direct SRS HLS is not protected by the current on_play admission hook; protection must be enforced by reverse proxy/CDN.' });
  }
  if (mode === 'SERVE' && transport === 'hls' && protection === 'none') {
    warnings.push({ code: 'HLS_DIRECT_UNPROTECTED', message: 'Direct SRS HLS is intentionally unprotected.' });
  }
  return { valid: true, reason_code: null, message: 'Combination is supported by current product/runtime capability.', alternatives: [], override_allowed: destination.state === 'UNKNOWN', warnings };
}

module.exports = { PRODUCT, PROTECTION, getCapabilities, validateOutput, runtimeSnapshot };
