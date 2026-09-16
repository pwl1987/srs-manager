import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { formatTime } from '../lib/utils';
import { Settings as SettingsIcon, Server, Clock, RefreshCw } from 'lucide-react';

export default function Settings() {
  const [srsConfig, setSrsConfig] = useState(null);
  const [ntpStatus, setNtpStatus] = useState(null);
  const [settings, setSettings] = useState({});
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    loadAll();
  }, []);

  async function loadAll() {
    try {
      setSrsConfig(await api.get('/settings/srs-config'));
      setNtpStatus(await api.get('/settings/ntp-status'));
      setSettings(await api.get('/settings'));
    } catch (err) {
      console.error(err);
    }
  }

  async function checkNtp() {
    setChecking(true);
    try {
      setNtpStatus(await api.get('/settings/ntp-status'));
    } catch (err) {
      console.error(err);
    } finally {
      setChecking(false);
    }
  }

  return (
    <div>
      <h2 className="text-xl font-bold mb-4">设置</h2>

      <div className="grid grid-cols-2 gap-6">
        {/* SRS Config */}
        <div className="bg-[var(--card)] rounded-lg border p-6">
          <div className="flex items-center gap-2 mb-4">
            <Server size={20} className="text-[var(--primary)]" />
            <h3 className="text-sm font-bold">SRS 配置</h3>
          </div>
          {srsConfig ? (
            <div className="space-y-3 text-sm">
              <div><span className="text-[var(--muted-foreground)]">API 地址：</span> <code className="text-xs">{srsConfig.api_url}</code></div>
              <div><span className="text-[var(--muted-foreground)]">API Token：</span> <code className="text-xs">{srsConfig.api_token}</code></div>
              <div><span className="text-[var(--muted-foreground)]">RTMP 端口：</span> {srsConfig.port}</div>
              <div><span className="text-[var(--muted-foreground)]">Hooks：</span> {srsConfig.hooks_enabled ? '启用' : '禁用'}</div>
              <div><span className="text-[var(--muted-foreground)]">Forward Backend：</span> <code className="text-xs">{srsConfig.forward_backend}</code></div>
            </div>
          ) : (
            <p className="text-sm text-[var(--muted-foreground)]">加载中...</p>
          )}
        </div>

        {/* NTP Status */}
        <div className="bg-[var(--card)] rounded-lg border p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Clock size={20} className="text-[var(--primary)]" />
              <h3 className="text-sm font-bold">NTP 时间同步</h3>
            </div>
            <button onClick={checkNtp} disabled={checking} className="flex items-center gap-1 px-2 py-1 rounded bg-[var(--secondary)] text-xs hover:bg-[var(--muted)] disabled:opacity-50">
              <RefreshCw size={12} className={checking ? 'animate-spin' : ''} /> 检查
            </button>
          </div>
          {ntpStatus ? (
            <div className="space-y-3 text-sm">
              <div>
                <span className="text-[var(--muted-foreground)]">同步状态：</span>
                <span className={ntpStatus.synced ? 'text-green-400' : 'text-red-400'}>
                  {ntpStatus.synced ? '已同步' : '未同步'}
                </span>
              </div>
              <div><span className="text-[var(--muted-foreground)]">系统时间：</span> {formatTime(ntpStatus.system_time)}</div>
              {ntpStatus.offset_ms !== null && (
                <div><span className="text-[var(--muted-foreground)]">偏移：</span> {ntpStatus.offset_ms} ms</div>
              )}
            </div>
          ) : (
            <p className="text-sm text-[var(--muted-foreground)]">加载中...</p>
          )}
          <p className="text-xs text-[var(--muted-foreground)] mt-4">
            网宿 CDN API 要求时间戳与服务器差 &lt; 5 分钟。请确保系统时间准确。
          </p>
        </div>
      </div>

      {/* Custom Settings */}
      {Object.keys(settings).length > 0 && (
        <div className="mt-6 bg-[var(--card)] rounded-lg border p-6">
          <h3 className="text-sm font-bold mb-4">自定义设置</h3>
          <div className="space-y-2 text-sm">
            {Object.entries(settings).map(([key, value]) => (
              <div key={key}>
                <span className="text-[var(--muted-foreground)]">{key}：</span> {value}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
