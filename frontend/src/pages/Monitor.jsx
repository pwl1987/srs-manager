import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { cn, formatTime, statusColor } from '../lib/utils';
import { formatCodec, formatBitrateKbps } from '../i18n/format';
import { getErrorCode } from '../lib/error-mapper';
import { usePolling } from '../lib/use-polling';
import { resolvePullHls } from '../lib/stream-url-display';
import ErrorBanner from '../components/ui/ErrorBanner';
import PageHeader from '../components/ui/PageHeader';
import { inputClass, labelClass, btnPrimary } from '../components/ui/styles';
import Hls from 'hls.js';
import * as echarts from 'echarts';
import { Monitor as MonitorIcon, Play, Pause, Loader2 } from 'lucide-react';

function formatHms(seconds) {
  if (seconds == null || isNaN(seconds)) return '-';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export default function Monitor() {
  const { t } = useTranslation(['monitor', 'streams', 'common']);
  const [streams, setStreams] = useState([]);
  const [streamsError, setStreamsError] = useState(null);
  const [selectedStream, setSelectedStream] = useState(null);
  const [monitorData, setMonitorData] = useState(null);
  const [historyData, setHistoryData] = useState(null);
  const [playing, setPlaying] = useState(false);
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const chartElRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    api.get('/streams')
      .then(setStreams)
      .catch(err => setStreamsError({ code: getErrorCode(err) }));
  }, []);

  // Select the stream object (needs pull_url_hls from the list response).
  function selectStream(id) {
    setSelectedStream(streams.find(s => String(s.id) === String(id)) || null);
  }

  async function loadMonitor(streamId) {
    try {
      setMonitorData(await api.get(`/monitor/streams/${streamId}`));
    } catch { /* keep last snapshot */ }
  }

  async function loadHistory(streamId) {
    try {
      setHistoryData(await api.get(`/monitor/streams/${streamId}/history?hours=24`));
    } catch { /* keep last snapshot */ }
  }

  useEffect(() => {
    if (selectedStream) {
      setMonitorData(null);
      setHistoryData(null);
      loadMonitor(selectedStream.id);
      loadHistory(selectedStream.id);
    }
  }, [selectedStream]);

  usePolling(
    () => { if (selectedStream) loadMonitor(selectedStream.id); },
    10000,
    Boolean(selectedStream)
  );

  // Chart lifecycle: init once, update option on data change, dispose on unmount.
  useEffect(() => {
    if (!chartElRef.current) return undefined;
    chartRef.current = echarts.init(chartElRef.current, 'dark');
    const onResize = () => chartRef.current?.resize();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      chartRef.current?.dispose();
      chartRef.current = null;
    };
  }, [selectedStream]);

  useEffect(() => {
    if (!chartRef.current || !historyData) return;
    chartRef.current.setOption({
      backgroundColor: 'transparent',
      title: { text: t('monitor:charts.viewers24h'), textStyle: { color: '#94a3b8', fontSize: 12 } },
      tooltip: { trigger: 'axis' },
      xAxis: {
        type: 'time',
        data: historyData.timeline.map(p => p.time),
        axisLabel: { color: '#94a3b8' }
      },
      yAxis: { type: 'value', name: t('monitor:labels.viewers'), axisLabel: { color: '#94a3b8' } },
      series: [{
        name: t('monitor:labels.viewers'),
        type: 'line',
        data: historyData.timeline.map(p => p.viewers),
        smooth: true,
        itemStyle: { color: '#3b82f6' },
        areaStyle: { color: 'rgba(59, 130, 246, 0.1)' }
      }]
    });
  }, [historyData, t]);

  useEffect(() => {
    return () => {
      if (hlsRef.current) hlsRef.current.destroy();
    };
  }, []);

  function togglePlay() {
    // Test mode (no CDN domain): fall back to the SRS direct-connect address.
    const source = resolvePullHls(selectedStream);
    if (!source) return;
    if (playing) {
      if (hlsRef.current) hlsRef.current.destroy();
      hlsRef.current = null;
      videoRef.current?.pause();
      setPlaying(false);
    } else {
      const video = videoRef.current;
      if (!video) return;
      if (Hls.isSupported()) {
        const hls = new Hls();
        hlsRef.current = hls;
        hls.loadSource(source);
        hls.attachMedia(video);
        video.play().catch(() => {});
        setPlaying(true);
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = source;
        video.play().catch(() => {});
        setPlaying(true);
      }
    }
  }

  return (
    <div>
      <PageHeader title={t('monitor:title')} subtitle={t('monitor:subtitle')} />

      <div className="mb-6 max-w-md">
        <label className={labelClass}>{t('monitor:labels.selectStream')}</label>
        <select
          value={selectedStream?.id || ''}
          onChange={e => selectStream(e.target.value)}
          className={inputClass}
        >
          <option value="">{t('monitor:labels.selectStreamPlaceholder')}</option>
          {streams.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        {streamsError && <ErrorBanner className="" message={t(`common:errors.${streamsError.code}`)} />}
      </div>

      {!selectedStream ? (
        <div className="bg-[var(--card)] rounded-lg border">
          <div className="flex flex-col items-center justify-center py-16">
            <MonitorIcon size={40} className="text-[var(--muted-foreground)] mb-4 opacity-50" />
            <p className="text-[var(--muted-foreground)]">{t('monitor:empty')}</p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Video Preview */}
          <div className="bg-[var(--card)] rounded-lg border p-4">
            <h3 className="text-sm font-bold mb-3">{t('monitor:labels.videoPreview')}</h3>
            <div className="aspect-video bg-black rounded relative overflow-hidden">
              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
              <video ref={videoRef} className="w-full h-full" controls />
              {!playing && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <p className="text-[var(--muted-foreground)] text-sm">{t('monitor:labels.clickToPlay')}</p>
                </div>
              )}
            </div>
            <button onClick={togglePlay} className={cn(btnPrimary, 'mt-3')}>
              {playing ? <Pause size={14} /> : <Play size={14} />}
              {playing ? t('monitor:actions.pause') : t('monitor:actions.play')}
            </button>
          </div>

          {/* Stats */}
          <div>
            <div className="bg-[var(--card)] rounded-lg border p-4 mb-4">
              <h3 className="text-sm font-bold mb-3">{t('monitor:labels.realTimeStatus')}</h3>
              {monitorData ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                  <div><span className="text-[var(--muted-foreground)]">{t('monitor:labels.status')}: </span>
                    <span className={statusColor(monitorData.status)}>{t(`streams:status.${monitorData.status}`, monitorData.status)}</span>
                  </div>
                  <div><span className="text-[var(--muted-foreground)]">{t('monitor:labels.viewers')}: </span>{monitorData.viewers || 0}</div>
                  <div><span className="text-[var(--muted-foreground)]">{t('monitor:labels.bitrate')}: </span>{formatBitrateKbps(monitorData.bitrate)}</div>
                  <div><span className="text-[var(--muted-foreground)]">{t('monitor:labels.lastOnline')}: </span>{monitorData.last_online_at ? formatTime(monitorData.last_online_at) : '-'}</div>
                  {monitorData.srs && (
                    <>
                      <div><span className="text-[var(--muted-foreground)]">{t('monitor:labels.videoCodec')}: </span>{formatCodec(monitorData.srs.vcodec)}</div>
                      <div><span className="text-[var(--muted-foreground)]">{t('monitor:labels.audioCodec')}: </span>{formatCodec(monitorData.srs.acodec)}</div>
                      <div><span className="text-[var(--muted-foreground)]">{t('monitor:labels.fps')}: </span>
                        {monitorData.srs.video_fps != null ? Number(monitorData.srs.video_fps).toFixed(1) : '-'}
                      </div>
                      <div><span className="text-[var(--muted-foreground)]">{t('monitor:labels.duration')}: </span>{formatHms(monitorData.srs.duration)}</div>
                    </>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-2 text-[var(--muted-foreground)] py-4">
                  <Loader2 size={14} className="animate-spin" />
                  {t('common:status.loading')}
                </div>
              )}
            </div>

            <div className="bg-[var(--card)] rounded-lg border p-4">
              <h3 className="text-sm font-bold mb-3">{t('monitor:labels.viewersTrend')}</h3>
              <div ref={chartElRef} style={{ width: '100%', height: 200 }} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
