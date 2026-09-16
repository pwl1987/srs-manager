const srsService = require('./srs');
const db = require('../database');

async function getStreamMonitor(streamId) {
  const stream = db.prepare('SELECT * FROM streams WHERE id = ?').get(streamId);
  if (!stream) return null;

  const srsStats = await srsService.getStreamStats(stream.name).catch(() => null);

  return {
    stream_id: stream.id,
    name: stream.name,
    status: stream.status,
    viewers: stream.viewers,
    bitrate: stream.bitrate,
    last_online_at: stream.last_online_at,
    srs: srsStats ? {
      stream_id: srsStats.stream_id,
      protocol: srsStats.protocol,
      client_ip: srsStats.client_ip,
      vcodec: srsStats.vcodec,
      acodec: srsStats.acodec,
      video_fps: srsStats.video_fps,
      video_bitrate: srsStats.video_bitrate,
      audio_bitrate: srsStats.audio_bitrate,
      duration: srsStats.duration
    } : null
  };
}

async function getDashboardStats() {
  const onlineStreams = db.prepare('SELECT COUNT(*) as count FROM streams WHERE status = \'online\'').get().count;
  const totalViewers = db.prepare('SELECT COALESCE(SUM(viewers), 0) as total FROM streams WHERE status = \'online\'').get().total;
  const totalBitrate = db.prepare('SELECT COALESCE(SUM(bitrate), 0) as total FROM streams WHERE status = \'online\'').get().total;

  const activeChannels = db.prepare('SELECT COUNT(*) as count FROM cdn_channels WHERE status = \'active\'').get().count;
  const totalChannels = db.prepare('SELECT COUNT(*) as count FROM cdn_channels').get().count;

  const activeRequests = db.prepare('SELECT COUNT(*) as count FROM distribution_requests WHERE status = \'active\'').get().count;
  const activeForwards = db.prepare('SELECT COUNT(*) as count FROM forward_tasks WHERE enabled = 1 AND status != \'error\'').get().count;

  return {
    online_streams: onlineStreams,
    total_viewers: totalViewers,
    total_bitrate: totalBitrate,
    active_channels: activeChannels,
    total_channels: totalChannels,
    active_distribution_requests: activeRequests,
    active_forward_tasks: activeForwards
  };
}

async function getStreamHistory(streamId, hours = 24) {
  const stream = db.prepare('SELECT * FROM streams WHERE id = ?').get(streamId);
  if (!stream) return null;

  const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();
  const events = db.prepare('SELECT * FROM hook_events WHERE stream_name = ? AND processed_at >= ? ORDER BY processed_at ASC')
    .all(stream.name, since);

  const timeline = [];
  let current = { stream_id: stream.id, viewers: 0, bitrate: 0 };
  for (const event of events) {
    if (event.event_type === 'on_publish') {
      current = { stream_id: stream.id, viewers: 0, bitrate: 0 };
    } else if (event.event_type === 'on_play') {
      current.viewers++;
    } else if (event.event_type === 'on_stop') {
      current.viewers = Math.max(0, current.viewers - 1);
    } else if (event.event_type === 'on_unpublish') {
      timeline.push({ time: event.processed_at, viewers: current.viewers, bitrate: current.bitrate });
      current = { stream_id: stream.id, viewers: 0, bitrate: 0 };
    }
  }
  timeline.push({ time: new Date().toISOString(), viewers: current.viewers, bitrate: current.bitrate });

  return { stream_id: stream.id, name: stream.name, timeline };
}

module.exports = { getStreamMonitor, getDashboardStats, getStreamHistory };
