import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { cn } from '../lib/utils';
import { formatBitrateKbps, formatDateTime, formatRelativeTime } from '../i18n/format';
import { getErrorCode } from '../lib/error-mapper';
import { usePolling } from '../lib/use-polling';
import ErrorBanner from '../components/ui/ErrorBanner';
import EmptyState from '../components/ui/EmptyState';
import { CardSkeleton } from '../components/ui/Skeleton';
import { Radio, Activity, Users, Satellite, FileText, ArrowLeftRight, TrendingUp, TrendingDown, Eye, EyeOff } from 'lucide-react';

function StatCard({ icon: Icon, label, value, sub }) {
  return (
    <div className="bg-[var(--card)] rounded-lg p-4 border">
      <div className="flex items-center gap-2 mb-2">
        <Icon size={20} className="text-[var(--primary)] shrink-0" />
        <span className="text-sm text-[var(--muted-foreground)] truncate">{label}</span>
      </div>
      <div className="text-2xl font-bold">{value}</div>
      {sub && <div className="text-xs text-[var(--muted-foreground)] mt-1">{sub}</div>}
    </div>
  );
}

const ACTIVITY_ICONS = {
  on_publish: { icon: TrendingUp, color: 'text-[var(--success)]' },
  on_unpublish: { icon: TrendingDown, color: 'text-[var(--destructive)]' },
  on_play: { icon: Eye, color: 'text-[var(--info)]' },
  on_stop: { icon: EyeOff, color: 'text-[var(--muted-foreground)]' },
};

export default function Dashboard() {
  const { t } = useTranslation(['streams', 'channels', 'common']);
  const [stats, setStats] = useState(null);
  const [streams, setStreams] = useState([]);
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  async function load(silent = false) {
    if (!silent) setLoading(true);
    if (!silent) setError(null);
    const [s, st, act] = await Promise.all([
      api.get('/monitor/dashboard').catch(err => { if (!silent) setError({ code: getErrorCode(err) }); return null; }),
      api.get('/streams').catch(() => []),
      api.get('/monitor/activity?limit=12').catch(() => [])
    ]);
    setStats(s);
    setStreams(Array.isArray(st) ? st : []);
    setActivities(Array.isArray(act) ? act : []);
    setLoading(false);
  }

  usePolling(() => load(true), 15000);

  const liveStreams = streams.filter(s => s.status === 'online').sort((a, b) => (b.viewers || 0) - (a.viewers || 0));
  const offlineStreams = streams.filter(s => s.status !== 'online');

  if (loading) {
    return (
      <div>
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4 mb-6">
          {[1, 2, 3, 4, 5, 6].map(i => <CardSkeleton key={i} className="h-28" />)}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <CardSkeleton className="h-64" />
          <CardSkeleton className="h-64" />
        </div>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-xl font-bold mb-6">{t('common:navigation.dashboard')}</h2>

      {error && <ErrorBanner message={t(`common:errors.${error.code}`)} onRetry={() => load()} />}

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4 mb-6">
          <StatCard icon={Radio} label={t('common:navigation.streams')} value={stats.online_streams} sub={t('common:dashboard.online')} />
          <StatCard icon={Users} label={t('streams:columns.viewers')} value={stats.total_viewers} />
          <StatCard icon={Activity} label={t('streams:columns.bitrate')} value={formatBitrateKbps(stats.total_bitrate)} />
          <StatCard icon={Satellite} label={t('common:navigation.cdnChannels')} value={`${stats.active_channels}/${stats.total_channels}`} sub={t('common:dashboard.activeTotal')} />
          <StatCard icon={FileText} label={t('common:navigation.distribution')} value={stats.active_distribution_requests} sub={t('common:dashboard.active')} />
          <StatCard icon={ArrowLeftRight} label={t('common:navigation.forwarding')} value={stats.active_forward_tasks} sub={t('common:dashboard.active')} />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-[var(--card)] rounded-lg border p-4 min-w-0">
          <h3 className="text-sm font-bold mb-3 flex items-center gap-2">
            <Radio size={16} className="text-[var(--success)]" />
            {t('streams:status.online')}
          </h3>
          {liveStreams.length === 0 ? (
            <p className="text-sm text-[var(--muted-foreground)] py-4 text-center">{t('streams:empty.title')}</p>
          ) : (
            <div>
              {liveStreams.map(s => (
                <div key={s.id} className="flex items-center justify-between gap-3 py-2 border-b last:border-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-2 h-2 rounded-full bg-[var(--success)] animate-pulse shrink-0" />
                    <span className="text-sm font-medium truncate">{s.name}</span>
                  </div>
                  <div className="text-xs text-[var(--muted-foreground)] flex gap-3 shrink-0">
                    <span>{s.viewers || 0} {t('streams:columns.viewers')}</span>
                    <span>{formatBitrateKbps(s.bitrate)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {offlineStreams.length > 0 && (
            <>
              <h3 className="text-sm font-bold mt-4 mb-3">{t('streams:status.offline')}</h3>
              <div>
                {offlineStreams.slice(0, 5).map(s => (
                  <div key={s.id} className="flex items-center justify-between gap-3 py-2 border-b last:border-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="w-2 h-2 rounded-full bg-[var(--border)] shrink-0" />
                      <span className="text-sm text-[var(--muted-foreground)] truncate">{s.name}</span>
                    </div>
                    <span className="text-xs text-[var(--muted-foreground)] shrink-0">{s.last_online_at ? formatDateTime(s.last_online_at) : '-'}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="bg-[var(--card)] rounded-lg border p-4 min-w-0">
          <h3 className="text-sm font-bold mb-3 flex items-center gap-2">
            <Activity size={16} className="text-[var(--primary)]" />
            {t('common:dashboard.recentActivity')}
          </h3>
          {activities.length === 0 ? (
            <EmptyState title={t('common:page.emptyTitle')} />
          ) : (
            <div>
              {activities.map((a, i) => {
                const meta = ACTIVITY_ICONS[a.event_type] || ACTIVITY_ICONS.on_stop;
                return (
                  <div key={i} className="flex items-center justify-between gap-3 py-2 border-b last:border-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <meta.icon size={14} className={cn(meta.color, 'shrink-0')} />
                      <span className="text-sm truncate">
                        <span className="font-medium">{a.stream_name}</span>
                        {' '}
                        {t(`common:dashboard.activity.${a.event_type}`, a.event_type)}
                      </span>
                    </div>
                    <span className="text-xs text-[var(--muted-foreground)] shrink-0" title={a.processed_at}>
                      {formatRelativeTime(a.processed_at)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
