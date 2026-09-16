import React, { useEffect, useState, useRef } from 'react';
import { api } from '../lib/api';
import { formatBytes, formatTime, statusColor } from '../lib/utils';
import Hls from 'hls.js';
import * as echarts from 'echarts';
import { Monitor as MonitorIcon, Play, Pause, X } from 'lucide-react';

export default function Monitor() {
  const [streams, setStreams] = useState([]);
  const [selectedStream, setSelectedStream] = useState(null);
  const [monitorData, setMonitorData] = useState(null);
  const [historyData, setHistoryData] = useState(null);
  const [playing, setPlaying] = useState(false);
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const chartRef = useRef(null);
  const timerRef = useRef(null);

  useEffect(() => {
    api.get('/streams').then(setStreams).catch(console.error);
  }, []);

  useEffect(() => {
    if (selectedStream) {
      loadMonitor(selectedStream.id);
      loadHistory(selectedStream.id);
      startPolling(selectedStream.id);
      return () => stopPolling();
    }
  }, [selectedStream]);

  useEffect(() => {
    if (historyData && chartRef.current) {
      renderChart();
    }
  }, [historyData]);

  useEffect(() => {
    return () => {
      stopPolling();
      if (hlsRef.current) hlsRef.current.destroy();
    };
  }, []);

  function startPolling(streamId) {
    stopPolling();
    timerRef.current = setInterval(() => loadMonitor(streamId), 10000);
  }

  function stopPolling() {
    if (timerRef.current) clearInterval(timerRef.current);
  }

  async function loadMonitor(streamId) {
    try {
      setMonitorData(await api.get(`/monitor/streams/${streamId}`));
    } catch (err) { console.error(err); }
  }

  async function loadHistory(streamId) {
    try {
      setHistoryData(await api.get(`/monitor/streams/${streamId}/history?hours=24`));
    } catch (err) { console.error(err); }
  }

  function renderChart() {
    if (!chartRef.current || !historyData) return;
    const chart = echarts.init(chartRef.current, 'dark');
    chart.setOption({
      backgroundColor: 'transparent',
      title: { text: '观众数 (24h)', textStyle: { color: '#94a3b8', fontSize: 12 } },
      tooltip: { trigger: 'axis' },
      xAxis: {
        type: 'time',
        data: historyData.timeline.map(p => p.time),
        axisLabel: { color: '#94a3b8' }
      },
      yAxis: { type: 'value', name: '观众数', axisLabel: { color: '#94a3b8' } },
      series: [{
        name: '观众数',
        type: 'line',
        data: historyData.timeline.map(p => p.viewers),
        smooth: true,
        itemStyle: { color: '#3b82f6' },
        areaStyle: { color: 'rgba(59, 130, 246, 0.1)' }
      }]
    });
    chart.resize();
  }

  function togglePlay() {
    if (!selectedStream?.pull_url_hls) return;
    if (playing) {
      if (hlsRef.current) hlsRef.current.destroy();
      hlsRef.current = null;
      setPlaying(false);
    } else {
      const video = videoRef.current;
      if (Hls.isSupported()) {
        const hls = new Hls();
        hlsRef.current = hls;
        hls.loadSource(selectedStream.pull_url_hls);
        hls.attachMedia(video);
        setPlaying(true);
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = selectedStream.pull_url_hls;
        setPlaying(true);
      }
    }
  }

  return (
    <div>
      <h2 className="text-xl font-bold mb-4">监控</h2>

      <div className="mb-4">
        <label className="block text-sm mb-1">选择流</label>
        <select
          value={selectedStream?.id || ''}
          onChange={e => setSelectedStream(streams.find(s => s.id === e.target.value))}
          className="w-64 px-3 py-2 rounded bg-[var(--input)] border text-sm focus:outline-none focus:border-[var(--ring)]"
        >
          <option value="">选择流...</option>
          {streams.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>

      {selectedStream && (
        <div className="grid grid-cols-2 gap-6">
          {/* Video Preview */}
          <div className="bg-[var(--card)] rounded-lg border p-4">
            <h3 className="text-sm font-bold mb-3">视频预览</h3>
            <div className="aspect-video bg-black rounded relative">
              <video ref={videoRef} className="w-full h-full" />
              {!playing && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <p className="text-[var(--muted-foreground)] text-sm">点击播放</p>
                </div>
              )}
            </div>
            <button onClick={togglePlay} className="mt-3 flex items-center gap-2 px-3 py-2 rounded bg-[var(--primary)] text-white text-sm hover:bg-[var(--accent)]">
              {playing ? <Pause size={14} /> : <Play size={14} />}
              {playing ? '暂停' : '播放'}
            </button>
          </div>

          {/* Stats */}
          <div>
            <div className="bg-[var(--card)] rounded-lg border p-4 mb-4">
              <h3 className="text-sm font-bold mb-3">实时状态</h3>
              {monitorData ? (
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div><span className="text-[var(--muted-foreground)]">状态：</span> <span className={statusColor(monitorData.status)}>{monitorData.status}</span></div>
                  <div><span className="text-[var(--muted-foreground)]">观众：</span> {monitorData.viewers || 0}</div>
                  <div><span className="text-[var(--muted-foreground)]">码率：</span> {monitorData.bitrate ? `${(monitorData.bitrate / 1000).toFixed(1)} kbps` : '-'}</div>
                  <div><span className="text-[var(--muted-foreground)]">最后在线：</span> {monitorData.last_online_at ? formatTime(monitorData.last_online_at) : '-'}</div>
                  {monitorData.srs && (
                    <>
                      <div><span className="text-[var(--muted-foreground)]">视频编码：</span> {monitorData.srs.vcodec}</div>
                      <div><span className="text-[var(--muted-foreground)]">音频编码：</span> {monitorData.srs.acodec}</div>
                      <div><span className="text-[var(--muted-foreground)]">FPS：</span> {monitorData.srs.video_fps.toFixed(1)}</div>
                      <div><span className="text-[var(--muted-foreground)]">时长：</span> {formatDuration(monitorData.srs.duration)}</div>
                    </>
                  )}
                </div>
              ) : (
                <p className="text-sm text-[var(--muted-foreground)]">加载中...</p>
              )}
            </div>

            <div className="bg-[var(--card)] rounded-lg border p-4">
              <h3 className="text-sm font-bold mb-3">观众趋势</h3>
              <div ref={chartRef} style={{ width: '100%', height: 200 }} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function formatDuration(seconds) {
  if (!seconds) return '-';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}
