import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { formatBytes, formatTime, statusColor } from '../lib/utils';
import { Radio, Satellite, Users, Activity, FileText, ArrowLeftRight } from 'lucide-react';

function StatCard({ icon: Icon, label, value, sub }) {
  return (
    <div className="bg-[var(--card)] rounded-lg p-4 border">
      <div className="flex items-center gap-2 mb-2">
        <Icon size={20} className="text-[var(--primary)]" />
        <span className="text-sm text-[var(--muted-foreground)]">{label}</span>
      </div>
      <div className="text-2xl font-bold">{value}</div>
      {sub && <div className="text-xs text-[var(--muted-foreground)] mt-1">{sub}</div>}
    </div>
  );
}

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [streams, setStreams] = useState([]);
  const [channels, setChannels] = useState([]);

  useEffect(() => {
    api.get('/monitor/dashboard').then(setStats).catch(console.error);
    api.get('/streams').then(setStreams).catch(console.error);
    api.get('/cdn/channels').then(setChannels).catch(console.error);
  }, []);

  return (
    <div>
      <h2 className="text-xl font-bold mb-4">Dashboard</h2>

      {stats && (
        <div className="grid grid-cols-5 gap-4 mb-6">
          <StatCard icon={Radio} label="在线流" value={stats.online_streams} />
          <StatCard icon={Activity} label="总带宽" value={formatBytes(stats.total_bitrate * 1000)} sub="kbps" />
          <StatCard icon={Users} label="总观众" value={stats.total_viewers} />
          <StatCard icon={Satellite} label="CDN 频道" value={`${stats.active_channels}/${stats.total_channels}`} sub="active/total" />
          <StatCard icon={FileText} label="分发申请" value={stats.active_distribution_requests} sub="active" />
        </div>
      )}

      <div className="grid grid-cols-2 gap-6">
        <div className="bg-[var(--card)] rounded-lg border p-4">
          <h3 className="text-sm font-bold mb-3">流状态</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[var(--muted-foreground)] border-b">
                <th className="text-left py-2">名称</th>
                <th className="text-left py-2">状态</th>
                <th className="text-right py-2">观众</th>
                <th className="text-right py-2">码率</th>
              </tr>
            </thead>
            <tbody>
              {streams.map(s => (
                <tr key={s.id} className="border-b">
                  <td className="py-2">{s.name}</td>
                  <td className={`py-2 ${statusColor(s.status)}`}>{s.status}</td>
                  <td className="py-2 text-right">{s.viewers || 0}</td>
                  <td className="py-2 text-right">{s.bitrate ? `${(s.bitrate / 1000).toFixed(1)} kbps` : '-'}</td>
                </tr>
              ))}
              {streams.length === 0 && <tr><td colSpan={4} className="py-4 text-center text-[var(--muted-foreground)]">暂无流</td></tr>}
            </tbody>
          </table>
        </div>

        <div className="bg-[var(--card)] rounded-lg border p-4">
          <h3 className="text-sm font-bold mb-3">CDN 频道概览</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[var(--muted-foreground)] border-b">
                <th className="text-left py-2">频道</th>
                <th className="text-left py-2">状态</th>
                <th className="text-left py-2">区域</th>
              </tr>
            </thead>
            <tbody>
              {channels.map(c => (
                <tr key={c.id} className="border-b">
                  <td className="py-2">{c.channel_name}</td>
                  <td className={`py-2 ${statusColor(c.status)}`}>{c.status}</td>
                  <td className="py-2">{c.region || '-'}</td>
                </tr>
              ))}
              {channels.length === 0 && <tr><td colSpan={3} className="py-4 text-center text-[var(--muted-foreground)]">暂无频道</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
