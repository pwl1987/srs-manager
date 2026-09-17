const crypto = require('node:crypto');
const db = require('../database');
const srsService = require('./srs');
const outPullService = require('./out-pull-service');
const legacyWorkspaceService = require('./stream-workspace-service');

const CONTRACT_VERSION = 'workspace-v3-phase00.1';
const ACTIVE_PULL_STATES = new Set(['STARTING', 'RUNNING', 'RETRYING']);

function parseRoomId(value) {
  const raw = String(value ?? '').trim();
  const match = raw.match(/^room:(\d+)$/);
  const id = Number(match ? match[1] : raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function roomId(streamId) { return `room:${Number(streamId)}`; }
function nowIso() { return new Date().toISOString(); }
function freshness(available) { return available ? 'FRESH' : 'UNKNOWN'; }

function canonicalCodec(value, kind) {
  const codec = String(value || (kind === 'video' ? 'h264' : 'aac')).toLowerCase();
  if (kind === 'video') {
    if (codec === 'libx264') return 'h264';
    if (codec === 'hevc' || codec === 'libx265') return 'h265';
  }
  if (kind === 'audio' && codec === 'libmp3lame') return 'mp3';
  return codec;
}

function stableObject(value) {
  if (Array.isArray(value)) return value.map(stableObject);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableObject(value[key])]));
}

function renditionSignature(template = {}) {
  const payload = stableObject({
    vcodec: canonicalCodec(template.vcodec, 'video'),
    acodec: canonicalCodec(template.acodec, 'audio'),
    video_config: template.video_config || {},
    audio_config: template.audio_config || {}
  });
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 20);
}

function projectOperation(operation) {
  if (!operation) return null;
  const projection = {
    QUEUED: ['QUEUED', 'REQUESTED'],
    STOPPING: ['RUNNING', 'STOPPING_OLD_SOURCE'],
    STARTING: ['RUNNING', 'STARTING_TARGET'],
    VERIFYING: ['VERIFYING', 'NONE'],
    SUCCEEDED: ['SUCCEEDED', 'NONE'],
    FAILED: ['FAILED', 'NONE'],
    CANCELLED: ['CANCELLED', 'NONE']
  }[operation.state] || ['RUNNING', String(operation.state || 'NONE')];
  return {
    id: `operation:${operation.id}`,
    legacy_operation_id: operation.id,
    type: operation.type,
    phase: projection[0],
    step: projection[1],
    requested_by: operation.requested_by || null,
    error: operation.error || null,
    created_at: operation.created_at,
    updated_at: operation.updated_at
  };
}

function sourceAvailability(task, source, isProgram) {
  if (isProgram) return 'ONLINE';
  if (!source.enabled || source.source_status !== 'active') return 'OFFLINE';
  if (Number(task?.active_source_id) !== Number(source.external_source_id)) return 'UNKNOWN';
  const state = String(task?.runtime_state || '').toUpperCase();
  if (['STARTING', 'RETRYING', 'FAILED', 'BLOCKED'].includes(state)) return state;
  return 'UNKNOWN';
}

function projectSources(workspace) {
  const streamId = workspace.stream.id;
  const task = workspace.inputs?.managed_pull?.task || null;
  const publisher = workspace.observed?.publisher || null;
  const publisherCount = Number(workspace.observed?.publishers_count || 0);
  const managedPullObserved = Boolean(workspace.inputs?.managed_pull?.observed_publisher);
  const pullMayOwn = Boolean(task && task.desired_state === 'RUNNING' && ACTIVE_PULL_STATES.has(task.runtime_state));

  let programSourceId = null;
  let attribution = 'NONE';
  if (workspace.observed?.online && publisherCount > 1) {
    attribution = 'AMBIGUOUS_MULTIPLE_PUBLISHERS';
  } else if (workspace.observed?.online && managedPullObserved && task?.active_source_id) {
    const active = (task.sources || []).find(x => Number(x.external_source_id) === Number(task.active_source_id));
    if (active) {
      programSourceId = `source:in_pull:ptsrc-${active.id}`;
      attribution = 'MANAGED_PULL_VERIFIED';
    }
  } else if (workspace.observed?.online && pullMayOwn) {
    attribution = 'UNKNOWN_PULL_OWNERSHIP';
  } else if (workspace.observed?.online && publisher) {
    programSourceId = `source:in_push:legacy-${streamId}`;
    attribution = 'EXTERNAL_PUSH_OBSERVED';
  }

  const sources = [{
    id: `source:in_push:legacy-${streamId}`,
    kind: 'IN_PUSH',
    name: 'Legacy Push Ingest',
    role: programSourceId === `source:in_push:legacy-${streamId}` ? 'PROGRAM' : 'CANDIDATE',
    availability: programSourceId === `source:in_push:legacy-${streamId}` ? 'ONLINE' : 'UNKNOWN',
    configured: true,
    evidence: publisher && programSourceId === `source:in_push:legacy-${streamId}` ? {
      level: 'OBSERVED', source: 'SRS API', observed_at: nowIso(), freshness: 'FRESH',
      publisher: { id: publisher.id, ip: publisher.ip || null, protocol: publisher.protocol || null }
    } : { level: 'CONFIGURED', source: 'legacy stream ingest', observed_at: null, freshness: 'UNKNOWN' },
    compatibility: { kind: 'legacy_stream_ingest', stream_id: streamId }
  }];

  for (const source of task?.sources || []) {
    const id = `source:in_pull:ptsrc-${source.id}`;
    const isProgram = id === programSourceId;
    sources.push({
      id,
      kind: 'IN_PULL',
      name: source.source_name,
      role: isProgram ? 'PROGRAM' : (source.enabled ? 'STANDBY' : 'CANDIDATE'),
      availability: sourceAvailability(task, source, isProgram),
      configured: true,
      protocol: source.source_protocol || null,
      source_url_masked: source.source_url_masked || null,
      evidence: isProgram ? {
        level: 'OBSERVED', source: 'Pull Worker + SRS API', observed_at: nowIso(), freshness: 'FRESH'
      } : {
        level: task && Number(task.active_source_id) === Number(source.external_source_id) ? 'RUNTIME' : 'CONFIGURED',
        source: task && Number(task.active_source_id) === Number(source.external_source_id) ? 'PullTask' : 'configuration',
        observed_at: null,
        freshness: 'UNKNOWN'
      },
      compatibility: {
        pull_task_source_id: source.id,
        pull_task_id: task.id,
        external_source_id: source.external_source_id,
        priority: source.priority,
        enabled: Boolean(source.enabled)
      }
    });
  }
  return { sources, programSourceId, attribution };
}

function projectRenditions(workspace) {
  const base = [{
    id: `rendition:${roomId(workspace.stream.id)}:program-original`,
    kind: 'PASSTHROUGH',
    signature: 'program-original',
    media_profile_id: null,
    runtime_state: workspace.observed?.online ? 'RUNNING' : 'STOPPED',
    observed: { online: workspace.observed?.online ?? null, media: workspace.observed?.media || null }
  }];
  for (const binding of workspace.processing?.transcodes || []) {
    base.push({
      id: `rendition:${roomId(workspace.stream.id)}:binding-${binding.id}`,
      kind: 'TRANSCODE',
      media_profile_id: `media-profile:${binding.template_id}`,
      signature: renditionSignature(binding.template),
      desired_state: binding.desired_state,
      runtime_state: binding.runtime_state,
      observed: binding.observed || { online: null, media: null },
      compatibility: { stream_transcode_binding_id: binding.id, output_stream_name: binding.output_stream_name }
    });
  }
  return base;
}

function workerEvidence(task, worker, label) {
  const owned = Boolean(task?.worker_instance_id && worker?.available && task.worker_instance_id === worker.instance_id);
  return {
    level: owned ? 'RUNTIME' : 'CONFIGURED',
    state: task?.runtime_state || 'UNKNOWN',
    source: owned ? label : 'database',
    observed_at: owned ? worker.last_seen_at : null,
    freshness: owned ? 'FRESH' : 'UNKNOWN'
  };
}

function projectOutputs(workspace) {
  const streamId = workspace.stream.id;
  const originalRef = `rendition:${roomId(streamId)}:program-original`;
  const outputs = [];
  for (const task of workspace.outputs?.forwards || []) {
    const legacy = task.execution_mode === 'srs_dynamic';
    outputs.push({
      id: `output:push:${task.id}`,
      name: task.target_type || `PUSH ${task.id}`,
      mode: 'PUSH',
      media_ref: originalRef,
      transport: task.target_protocol || null,
      control_mode: legacy ? 'LEGACY_UNMANAGED' : 'MANAGED',
      desired_state: task.desired_state,
      runtime_state: legacy ? 'UNKNOWN' : task.runtime_state,
      destination: { kind: 'CUSTOM', label: task.target_type || null, target_url_masked: task.target_url_masked || null },
      evidence: {
        local: legacy ? { level: 'DESIRED', state: 'UNKNOWN', source: 'legacy SRS dynamic forward config', observed_at: null, freshness: 'UNKNOWN' }
          : workerEvidence(task, workspace.outputs?.push_worker, 'Push Worker heartbeat'),
        remote: { state: 'UNKNOWN', source: null, observed_at: null, freshness: 'UNKNOWN' }
      },
      compatibility: { forward_task_id: task.id, execution_mode: task.execution_mode }
    });
  }

  const serve = workspace.outputs?.out_pull;
  if (serve?.policy) {
    const endpoints = workspace.outputs?.pull_endpoints || {};
    outputs.push({
      id: `output:serve:${streamId}`,
      name: 'Legacy Pull Access',
      mode: 'SERVE',
      media_ref: originalRef,
      runtime_state: serve.policy.endpoint_enabled ? 'AVAILABLE' : 'DISABLED',
      endpoints: [
        { transport: 'rtmp', url: endpoints.rtmp || null, available: Boolean(serve.policy.endpoint_enabled) },
        { transport: 'http-flv', url: endpoints.flv || null, available: Boolean(serve.policy.endpoint_enabled) },
        { transport: 'hls', url: endpoints.hls || null, available: Boolean(serve.policy.endpoint_enabled), protection_boundary: 'reverse_proxy_or_cdn' }
      ],
      protection: {
        accepting_new_sessions: Boolean(serve.policy.accepting_new_sessions),
        require_grant: Boolean(serve.policy.require_grant),
        grants: (serve.grants || []).map(grant => ({ id: grant.id, label: grant.label, token_hint: grant.token_hint, status: grant.status, expires_at: grant.expires_at }))
      },
      sessions: { active_external: (serve.active_sessions || []).length },
      evidence: {
        local: { level: 'CONFIGURED', state: serve.policy.endpoint_enabled ? 'AVAILABLE' : 'DISABLED', source: 'OUT-PULL policy', observed_at: serve.policy.updated_at, freshness: 'UNKNOWN' },
        remote: { state: 'UNAVAILABLE', source: null, observed_at: null, freshness: 'UNKNOWN' }
      },
      compatibility: { out_pull_policy_stream_id: streamId }
    });
  }
  return outputs;
}

function projectProviderChannels(workspace) {
  return (workspace.outputs?.cdn_channels || []).map(channel => ({
    cdn_channel_id: channel.id,
    provider_channel_id: channel.channel_id || null,
    name: channel.channel_name,
    role: 'provider_integration',
    remote_state: channel.remote_state || 'unknown',
    remote_bitrate: channel.remote_bitrate ?? null,
    remote_viewers: channel.remote_viewers ?? null,
    runtime_claim: false
  }));
}

async function getWorkspace(roomValue) {
  const streamId = parseRoomId(roomValue);
  if (!streamId) return null;
  const legacy = await legacyWorkspaceService.getWorkspace(streamId);
  if (!legacy) return null;
  const { sources, programSourceId, attribution } = projectSources(legacy);
  const operations = [legacy.inputs?.managed_pull?.active_operation, ...(legacy.inputs?.managed_pull?.operations || [])]
    .filter(Boolean).filter((op, index, all) => all.findIndex(x => x.id === op.id) === index).map(projectOperation);

  return {
    contract_version: CONTRACT_VERSION,
    room: {
      id: roomId(streamId), legacy_stream_id: streamId, name: legacy.stream.name,
      routing: { app: 'live', stream_name: legacy.stream.name },
      created_at: legacy.stream.created_at || null, updated_at: legacy.stream.updated_at || null
    },
    session: null,
    sources,
    program: {
      id: `program:${roomId(streamId)}`,
      state: legacy.observed?.online ? 'LIVE' : 'NO_PROGRAM',
      source_id: programSourceId,
      attribution,
      media: legacy.observed?.media || null,
      bitrate: legacy.observed?.bitrate ?? 0,
      viewers: legacy.observed?.viewers ?? null,
      uptime_seconds: legacy.observed?.uptime_seconds ?? null,
      evidence: {
        source: 'SRS API', observed_at: nowIso(), freshness: freshness(legacy.observed?.srs_available),
        publisher_count: legacy.observed?.publishers_count ?? null
      }
    },
    renditions: projectRenditions(legacy),
    outputs: projectOutputs(legacy),
    evidence: {
      srs: { available: Boolean(legacy.observed?.srs_available), source: 'SRS API', observed_at: nowIso(), freshness: freshness(legacy.observed?.srs_available) },
      workers: {
        pull: legacy.inputs?.managed_pull?.worker || null,
        push: legacy.outputs?.push_worker || null,
        transcode: legacy.processing?.worker || null
      }
    },
    health: { status: 'UNKNOWN', reasons: ['Phase 02 health evaluator not active'] },
    capabilities: {
      phase: '01',
      program_preview: { hls_secure_proxy: true, http_flv_secure_proxy: false },
      source_preview: false,
      output_push: { transports: ['rtmp', 'rtmps', 'srt'], runtime_available: Boolean(legacy.outputs?.push_worker?.available) },
      output_serve: { transports: ['rtmp', 'http-flv', 'hls'], policy_available: Boolean(legacy.outputs?.out_pull) },
      transcode: { runtime_available: Boolean(legacy.processing?.worker?.available) },
      record: false
    },
    operations,
    incidents: [],
    timeline: (legacy.activity || []).map(event => ({
      type: event.event_type, occurred_at: event.processed_at, source: 'hook_events', compatibility: { stream_name: event.stream_name }
    })),
    compatibility: {
      legacy_distribution_count: (legacy.distribution || []).length,
      provider_channels: projectProviderChannels(legacy)
    }
  };
}

async function listRooms() {
  const localStreams = db.prepare('SELECT id, name, status FROM streams ORDER BY created_at DESC').all();
  const [streamsResult, clientsResult] = await Promise.allSettled([
    srsService.getStreams(),
    srsService.listClients()
  ]);
  const srsAvailable = streamsResult.status === 'fulfilled';
  const clientsAvailable = clientsResult.status === 'fulfilled';
  const srsStreams = srsAvailable ? streamsResult.value : [];
  const clients = clientsAvailable ? clientsResult.value : [];
  const liveByName = new Map(srsStreams.filter(item => (item.app || 'live') === 'live').map(item => [item.name, item]));

  return localStreams.map(stream => {
    const observed = liveByName.get(stream.name) || null;
    const nonAudience = outPullService.nonAudienceClientIds(stream.id);
    const audience = clientsAvailable && observed ? clients.filter(client =>
      srsService.clientMatchesStream(client, stream.name, 'live')
        && !String(client?.type || '').toLowerCase().includes('publish')
        && !nonAudience.has(String(client.id))
    ).length : null;
    const kbps = observed ? Math.round(Number(observed?.kbps?.recv_30s ?? observed?.kbps?.publish ?? observed?.stream?.inbps)) || 0 : 0;
    const liveMs = Number(observed?.live_ms);
    const uptime = observed && Number.isFinite(liveMs) && liveMs > 0 && liveMs <= Date.now()
      ? Math.max(0, Math.floor((Date.now() - liveMs) / 1000)) : null;
    const programState = !srsAvailable ? 'UNKNOWN' : observed ? 'LIVE' : 'NO_PROGRAM';
    return {
      contract_version: CONTRACT_VERSION,
      room: {
        id: roomId(stream.id), legacy_stream_id: stream.id, name: stream.name,
        routing: { app: 'live', stream_name: stream.name }
      },
      session: null,
      program: {
        state: programState,
        bitrate: observed ? kbps : null,
        viewers: audience,
        uptime_seconds: uptime,
        evidence: { source: 'SRS API', observed_at: nowIso(), freshness: srsAvailable ? 'FRESH' : 'UNKNOWN' }
      },
      outputs: { required_total: 0, required_healthy: 0, record_state: null },
      health: { status: 'UNKNOWN', reasons: ['Phase 02 health evaluator not active'] },
      active_incidents: 0,
      compatibility: { legacy_stream_status: stream.status || null }
    };
  });
}

module.exports = {
  CONTRACT_VERSION,
  parseRoomId,
  roomId,
  renditionSignature,
  projectOperation,
  getWorkspace,
  listRooms
};
