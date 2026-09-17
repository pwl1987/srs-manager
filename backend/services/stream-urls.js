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
  // When no CDN domain is configured the panel runs in test mode: pull URLs
  // are left null and the frontend serves SRS direct-connect URLs instead.
  const cdnConfigured = settingsService.isCdnDomainConfigured();
  const cdnDomain = settingsService.getCdnDomain();
  return {
    push_url: `rtmp://${srsHost}:${rtmpPort}/live/${streamName}`,
    pull_url_hls: cdnConfigured ? `https://${cdnDomain}/${streamName}/index.m3u8` : null,
    pull_url_flv: cdnConfigured ? `https://${cdnDomain}/${streamName}.flv` : null,
    pull_url_rtmp: cdnConfigured ? `rtmp://${cdnDomain}/live/${streamName}` : null,
    cdn_configured: cdnConfigured,
    http_port: settingsService.getSrsHttpPort(),
    rtmp_port: rtmpPort
  };
}

module.exports = { buildUrls };
