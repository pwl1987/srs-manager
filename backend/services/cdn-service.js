const wangsuService = require('./wangsu');
const db = require('../database');

async function listChannels() {
  return db.prepare('SELECT * FROM cdn_channels ORDER BY created_at DESC').all();
}

async function getChannel(id) {
  return db.prepare('SELECT * FROM cdn_channels WHERE id = ?').get(id) || null;
}

async function createChannel({ channel_name, stream_id, push_domain, pull_domain, region }) {
  if (!channel_name || !push_domain) throw new Error('Channel name and push domain are required');

  const result = await wangsuService.createChannel({
    ChannelName: channel_name,
    PushDomain: push_domain,
    PullDomain: pull_domain || push_domain
  });

  db.prepare(`
    INSERT INTO cdn_channels (stream_id, channel_name, channel_id, push_domain, pull_url_hls, pull_url_rtmp, region)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    stream_id,
    channel_name,
    result.PullId || result.ChannelId,
    push_domain,
    `https://${pull_domain || push_domain}/${channel_name}/index.m3u8`,
    `rtmp://${pull_domain || push_domain}/live/${channel_name}`,
    region || null
  );

  return db.prepare('SELECT * FROM cdn_channels WHERE channel_name = ?').get(channel_name);
}

async function updateChannel(id, { region, stream_id }) {
  const channel = db.prepare('SELECT * FROM cdn_channels WHERE id = ?').get(id);
  if (!channel) return null;

  const updates = {};
  if (region !== undefined) updates.region = region;
  if (stream_id !== undefined) updates.stream_id = stream_id;

  if (Object.keys(updates).length > 0) {
    const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    db.prepare(`UPDATE cdn_channels SET ${setClauses}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(...Object.values(updates), id);
  }

  return db.prepare('SELECT * FROM cdn_channels WHERE id = ?').get(id);
}

async function deleteChannel(id) {
  const channel = db.prepare('SELECT * FROM cdn_channels WHERE id = ?').get(id);
  if (!channel) return null;

  if (channel.channel_id) {
    await wangsuService.deleteChannel(channel.channel_id);
  }
  db.prepare('DELETE FROM cdn_channels WHERE id = ?').run(id);
  return { name: channel.channel_name };
}

async function getBatchState() {
  const channels = db.prepare('SELECT channel_id, channel_name FROM cdn_channels WHERE channel_id IS NOT NULL').all();
  if (channels.length === 0) return [];

  const channelIds = channels.map(c => c.channel_id);
  const result = await wangsuService.batchChannelLiveState(channelIds);

  return channels.map(c => {
    const liveState = result.ChannelStates?.find(s => s.ChannelId === c.channel_id);
    return {
      channel_id: c.channel_id,
      channel_name: c.channel_name,
      is_live: liveState ? liveState.Live === 1 : false,
      bitrate: liveState ? liveState.Bitrate || 0 : 0,
      viewers: liveState ? liveState.Viewers || 0 : 0
    };
  });
}

module.exports = { listChannels, getChannel, createChannel, updateChannel, deleteChannel, getBatchState };
