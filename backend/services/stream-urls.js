const settingsService = require('./settings-service');

function buildUrls(streamName) {
  let srsHost = 'localhost';
  try {
    srsHost = new URL(settingsService.getSrsApiUrl()).hostname || 'localhost';
  } catch {
    srsHost = 'localhost';
  }
  const rtmpPort = settingsService.getRtmpPort();
  const httpPort = settingsService.getSrsHttpPort();
  const cdnConfigured = settingsService.isCdnDomainConfigured();
  const cdnDomain = settingsService.getCdnDomain();

  // Raw SRS HTTP endpoints bypass Manager preview tokens and HLS does not pass
  // through on_play. Hide them unless trusted-network diagnostics explicitly opt in.
  const exposeOriginHttp = process.env.EXPOSE_SRS_HTTP_ORIGIN_URLS === '1';

  return {
    push_url: `rtmp://${srsHost}:${rtmpPort}/live/${streamName}`,
    origin_pull_url_hls: exposeOriginHttp ? `http://${srsHost}:${httpPort}/live/${streamName}.m3u8` : null,
    origin_pull_url_flv: exposeOriginHttp ? `http://${srsHost}:${httpPort}/live/${streamName}.flv` : null,
    origin_pull_url_rtmp: `rtmp://${srsHost}:${rtmpPort}/live/${streamName}`,
    origin_http_exposed: exposeOriginHttp,
    pull_url_hls: cdnConfigured ? `https://${cdnDomain}/${streamName}/index.m3u8` : null,
    pull_url_flv: cdnConfigured ? `https://${cdnDomain}/${streamName}.flv` : null,
    pull_url_rtmp: cdnConfigured ? `rtmp://${cdnDomain}/live/${streamName}` : null,
    cdn_configured: cdnConfigured,
    http_port: httpPort,
    rtmp_port: rtmpPort
  };
}

module.exports = { buildUrls };
