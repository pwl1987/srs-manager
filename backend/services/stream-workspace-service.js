const db = require('../database');
const srsService = require('./srs');
const streamService = require('./stream-service');
const cdnService = require('./cdn-service');
const pullTaskService = require('./pull-task-service');
const operationService = require('./operation-service');
const pushTaskService = require('./push-task-service');
const outPullService = require('./out-pull-service');

function isPublisher(client) {
  return String(client?.type || '').toLowerCase().includes('publish');
}

function liveStats(srsStream) {
  if (!srsStream) return { bitrate: 0, viewers: 0 };
  const kbpsSource = srsStream?.kbps?.recv_30s ?? srsStream?.kbps?.publish ?? srsStream?.stream?.inbps;
  const bitrate = Math.round(Number(kbpsSource)) || 0;
  const clients = Math.round(Number(srsStream?.clients ?? srsStream?.stream?.cur_client)) || 0;
  return { bitrate, viewers: Math.max(0, clients - 1) };
}

function uptimeSeconds(streamName, online) {
  if (!online) return null;
  const row = db.prepare("SELECT processed_at FROM hook_events WHERE event_type = 'on_publish' AND stream_name = ?")
    .get(streamName);
  if (!row?.processed_at) return null;
  const startedAt = Date.parse(row.processed_at.replace(' ', 'T') + 'Z');
  if (!Number.isFinite(startedAt)) return null;
  return Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
}

async function getWorkspace(streamId) {
  const id = Number(streamId);
  if (!Number.isInteger(id) || id <= 0) return null;

  const stream = await streamService.getStream(id);
  if (!stream) return null;

  const pullTask = pullTaskService.getTaskByStream(id);
  const pullWorker = pullTaskService.getWorkerHealth();
  const pushWorker = pushTaskService.getWorkerHealth();
  const outPull = outPullService.getOverview(id);
  const pullOperation = pullTask ? operationService.getActivePullSwitch(pullTask.id) : null;
  const pullOperationHistory = pullTask ? operationService.listPullOperations(pullTask.id, 5) : [];

  const [srsStreamsResult, clientsResult, cdnStatesResult] = await Promise.allSettled([
    srsService.getStreams(),
    srsService.listClients(),
    cdnService.getBatchState()
  ]);

  const srsAvailable = srsStreamsResult.status === 'fulfilled';
  const clientsAvailable = clientsResult.status === 'fulfilled';
  const srsStreams = srsAvailable ? srsStreamsResult.value : [];
  const clients = clientsAvailable ? clientsResult.value : [];
  const srsStream = srsStreams.find(item => item.name === stream.name && (item.app || 'live') === 'live');
  const relatedClients = clients.filter(client => (client.app || 'live') === 'live' && client.stream === stream.name);
  const publishers = relatedClients.filter(isPublisher);
  const players = relatedClients.filter(client => !isPublisher(client));
  const stats = liveStats(srsStream);

  const forwards = pushTaskService.listTasksByStream(id);
  const channels = db.prepare('SELECT * FROM cdn_channels WHERE stream_id = ? ORDER BY created_at DESC').all(id);
  const distributions = db.prepare('SELECT * FROM distribution_requests WHERE stream_id = ? ORDER BY created_at DESC').all(id);
  const activity = db.prepare(`
    SELECT event_type, stream_name, processed_at
    FROM hook_events
    WHERE stream_name = ?
    ORDER BY processed_at DESC
    LIMIT 12
  `).all(stream.name);

  const cdnStates = cdnStatesResult.status === 'fulfilled' ? cdnStatesResult.value : null;
  const cdnById = new Map((cdnStates || []).map(state => [String(state.channel_id), state]));
  const enrichedChannels = channels.map(channel => {
    const remote = channel.channel_id ? cdnById.get(String(channel.channel_id)) : null;
    return {
      ...channel,
      remote_state: cdnStates === null ? 'unknown' : (remote?.is_live ? 'live' : 'idle'),
      remote_bitrate: remote?.bitrate ?? null,
      remote_viewers: remote?.viewers ?? null
    };
  });

  const publisher = publishers[0] || null;
  const online = srsAvailable ? Boolean(srsStream) : null;
  const managedPullObserved = Boolean(
    pullTask
      && pullTask.runtime_state === 'RUNNING'
      && publisher
      && pullTask.worker_instance_id
      && pullTask.worker_instance_id === pullWorker.instance_id
      && pullWorker.available
  );

  return {
    stream,
    inputs: {
      managed_pull: {
        task: pullTask,
        worker: pullWorker,
        observed_publisher: managedPullObserved,
        active_operation: pullOperation,
        operations: pullOperationHistory
      }
    },
    observed: {
      srs_available: srsAvailable,
      clients_available: clientsAvailable,
      online,
      bitrate: online ? stats.bitrate : 0,
      viewers: online ? stats.viewers : 0,
      uptime_seconds: uptimeSeconds(stream.name, online === true),
      publisher: publisher ? {
        id: publisher.id,
        ip: publisher.ip || null,
        type: publisher.type || null,
        protocol: publisher.protocol || null
      } : null,
      publishers_count: publishers.length,
      players: {
        count: clientsAvailable ? players.length : null
      }
    },
    outputs: {
      forwards,
      push_worker: pushWorker,
      out_pull: outPull,
      cdn_channels: enrichedChannels,
      pull_endpoints: {
        hls: stream.pull_url_hls || null,
        flv: stream.pull_url_flv || null,
        rtmp: stream.pull_url_rtmp || null
      }
    },
    distribution: distributions,
    activity,
    capabilities: {
      disconnect_publisher: clientsAvailable && publishers.length > 0,
      disconnect_viewers: clientsAvailable && players.length > 0,
      in_pull_runtime: pullWorker.available,
      out_push_runtime: pushWorker.available,
      out_pull_policy: Boolean(outPull)
    }
  };
}

module.exports = { getWorkspace, isPublisher };
