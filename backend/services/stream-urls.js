const settingsService = require('./settings-service');

function buildUrls(streamName) {
  let srsHost = 'localhost';
  try {
    // hostname excludes the API port; the RTMP port is appended separately.
    srsHost = new URL(settingsService.getSrsApiUrl()).hostname || 'localhost';
  } catch {
    srsHost = 'localhost';
  }
  const rtmpPort = settingsService.getRtmpPort();
  const cdnDomain = settingsService.getCdnDomain();
  return {
    push_url: `rtmp://${srsHost}:${rtmpPort}/live/${streamName}`,
    pull_url_hls: `https://${cdnDomain}/${streamName}/index.m3u8`,
    pull_url_rtmp: `rtmp://${cdnDomain}/live/${streamName}`
  };
}

module.exports = { buildUrls };
