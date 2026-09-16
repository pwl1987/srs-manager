const db = require('../database');

function buildUrls(streamName) {
  const srsHost = new URL(process.env.SRS_API_URL || '').host || 'localhost';
  const cdnDomain = db.prepare('SELECT value FROM settings WHERE key = ?').get('cdn_domain')?.value || 'cdn.example.com';
  return {
    push_url: `rtmp://${srsHost}:1935/live/${streamName}`,
    pull_url_hls: `https://${cdnDomain}/${streamName}/index.m3u8`,
    pull_url_rtmp: `rtmp://${cdnDomain}/live/${streamName}`
  };
}

module.exports = { buildUrls };
