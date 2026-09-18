const settingsService = require('./settings-service');

function buildUrls(streamName) {
  const encodedStreamName = encodeURIComponent(String(streamName));
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
    push_url: `rtmp://${srsHost}:${rtmpPort}/live/${encodedStreamName}`,
    origin_pull_url_hls: exposeOriginHttp ? `http://${srsHost}:${httpPort}/live/${encodedStreamName}.m3u8` : null,
    origin_pull_url_flv: exposeOriginHttp ? `http://${srsHost}:${httpPort}/live/${encodedStreamName}.flv` : null,
    origin_pull_url_rtmp: `rtmp://${srsHost}:${rtmpPort}/live/${encodedStreamName}`,
    origin_http_exposed: exposeOriginHttp,
    pull_url_hls: cdnConfigured ? `https://${cdnDomain}/${encodedStreamName}/index.m3u8` : null,
    pull_url_flv: cdnConfigured ? `https://${cdnDomain}/${encodedStreamName}.flv` : null,
    pull_url_rtmp: cdnConfigured ? `rtmp://${cdnDomain}/live/${encodedStreamName}` : null,
    cdn_configured: cdnConfigured,
    http_port: httpPort,
    rtmp_port: rtmpPort
  };
}

module.exports = { buildUrls };
