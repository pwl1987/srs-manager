const srsService = require('./srs');
const db = require('../database');

function durationSeconds(srsStream) {
  const liveMs = Number(srsStream?.live_ms);
  if (!Number.isFinite(liveMs) || liveMs <= 0 || liveMs > Date.now()) return null;
  return Math.max(0, Math.floor((Date.now() - liveMs) / 1000));
}

async function getStreamMonitor(streamId) {
  const id = parseInt(streamId, 10);
  if (!Number.isInteger(id) || id <= 0) return null;
  const stream = db.prepare('SELECT * FROM streams WHERE id = ?').get(id);
  if (!stream) return null;

  const [streamsResult, clientsResult] = await Promise.allSettled([
    srsService.getStreams(),
    srsService.listClients()
  ]);
  const streams = streamsResult.status === 'fulfilled' ? streamsResult.value : [];
  const clients = clientsResult.status === 'fulfilled' ? clientsResult.value : [];
  const live = streams.find(item => item.name === stream.name && (item.app || 'live') === 'live') || null;
  const relatedClients = clients.filter(client => srsService.clientMatchesStream(client, stream.name, 'live'));
  const viewers = relatedClients.filter(client => !String(client?.type || '').toLowerCase().includes('publish')).length;
  const bitrate = live ? Math.round(Number(live?.kbps?.recv_30s || 0)) : 0;

  return {
    stream_id: stream.id,
    name: stream.name,
    status: streamsResult.status === 'fulfilled' ? (live ? 'online' : 'offline') : stream.status,
    viewers: clientsResult.status === 'fulfilled' ? viewers : stream.viewers,
    bitrate: live ? bitrate : stream.bitrate,
    last_online_at: stream.last_online_at,
    srs: live ? {
      stream_id: live.id || null,
      protocol: stream.protocol || null,
      client_ip: relatedClients.find(client => String(client?.type || '').toLowerCase().includes('publish'))?.ip || null,
      vcodec: live.video?.codec || null,
      acodec: live.audio?.codec || null,
      width: Number(live.video?.width || 0) || null,
      height: Number(live.video?.height || 0) || null,
      sample_rate: Number(live.audio?.sample_rate || 0) || null,
      channels: Number(live.audio?.channel || 0) || null,
      video_fps: null,
      video_bitrate: bitrate,
      audio_bitrate: null,
      duration: durationSeconds(live)
    } : null
  };
}

async function getDashboardStats() {
  const onlineStreams = db.prepare("SELECT COUNT(*) as count FROM streams WHERE status = 'online'").get().count;
  const totalViewers = db.prepare("SELECT COALESCE(SUM(viewers), 0) as total FROM streams WHERE status = 'online'").get().total;
  const totalBitrate = db.prepare("SELECT COALESCE(SUM(bitrate), 0) as total FROM streams WHERE status = 'online'").get().total;
  const activeChannels = db.prepare("SELECT COUNT(*) as count FROM cdn_channels WHERE status = 'active'").get().count;
  const totalChannels = db.prepare('SELECT COUNT(*) as count FROM cdn_channels').get().count;
  const activeRequests = db.prepare("SELECT COUNT(*) as count FROM distribution_requests WHERE status = 'active'").get().count;
  const activeForwards = db.prepare("SELECT COUNT(*) as count FROM forward_tasks WHERE enabled = 1 AND status != 'error'").get().count;
  return { online_streams: onlineStreams, total_viewers: totalViewers, total_bitrate: totalBitrate, active_channels: activeChannels, total_channels: totalChannels, active_distribution_requests: activeRequests, active_forward_tasks: activeForwards };
}

async function getStreamHistory(streamId, hours = 24) {
  const id = parseInt(streamId, 10);
  if (!Number.isInteger(id) || id <= 0) return null;
  const stream = db.prepare('SELECT * FROM streams WHERE id = ?').get(id);
  if (!stream) return null;
  const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();
  const events = db.prepare('SELECT * FROM hook_events WHERE stream_name = ? AND processed_at >= ? ORDER BY processed_at ASC').all(stream.name, since);
  const timeline = [];
  let current = { stream_id: stream.id, viewers: 0, bitrate: 0 };
  for (const event of events) {
    if (event.event_type === 'on_publish') current = { stream_id: stream.id, viewers: 0, bitrate: 0 };
    else if (event.event_type === 'on_play') current.viewers++;
    else if (event.event_type === 'on_stop') current.viewers = Math.max(0, current.viewers - 1);
    else if (event.event_type === 'on_unpublish') { timeline.push({ time: event.processed_at, viewers: current.viewers, bitrate: current.bitrate }); current = { stream_id: stream.id, viewers: 0, bitrate: 0 }; }
  }
  timeline.push({ time: new Date().toISOString(), viewers: current.viewers, bitrate: current.bitrate });
  return { stream_id: stream.id, name: stream.name, timeline };
}

module.exports = { getStreamMonitor, getDashboardStats, getStreamHistory };
