import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { cn } from '../lib/utils';
import { formatBitrateKbps, formatDateTime, formatRelativeTime } from '../i18n/format';
import { getErrorCode } from '../lib/error-mapper';
import { usePolling } from '../lib/use-polling';
import PageHeader from '../components/ui/PageHeader';
import ErrorBanner from '../components/ui/ErrorBanner';
import EmptyState from '../components/ui/EmptyState';
import { CardSkeleton } from '../components/ui/Skeleton';
import { CURRENT_VERSION } from '../lib/releases';
import {
  Radio,
  Activity,
  Users,
  Satellite,
  FileText,
  ArrowLeftRight,
  TrendingUp,
  TrendingDown,
  Eye,
  EyeOff,
  Server,
  ArrowUpFromLine,
  ArrowDownToLine,
  Sparkles,
} from 'lucide-react';

const ACTIVITY_ICONS = {
  on_publish: { icon: TrendingUp, color: 'text-[var(--success)]' },
  on_unpublish: { icon: TrendingDown, color: 'text-[var(--destructive)]' },
  on_play: { icon: Eye, color: 'text-[var(--info)]' },
  on_stop: { icon: EyeOff, color: 'text-[var(--muted-foreground)]' },
};

function Metric({ icon: Icon, label, value, detail, tone = 'primary' }) {
  const tones = {
    primary: 'text-[var(--primary)] bg-[var(--primary)]/10 border-[var(--primary)]/15',
    success: 'text-[var(--success)] bg-[var(--success)]/10 border-[var(--success)]/15',
    info: 'text-[var(--info)] bg-[var(--info)]/10 border-[var(--info)]/15',
    warning: 'text-[var(--warning)] bg-[var(--warning)]/10 border-[var(--warning)]/15',
  };

  return (
    <div className="min-w-0 p-4 rounded-xl border border-[var(--border-soft)] bg-[var(--background)]/26">
      <div className="flex items-center justify-between gap-3 mb-4">
        <span className="text-xs font-medium text-[var(--muted-foreground)] truncate">{label}</span>
        <span className={cn('w-8 h-8 rounded-lg border flex items-center justify-center shrink-0', tones[tone] || tones.primary)}>
          <Icon size={15} strokeWidth={1.9} />
        </span>
      </div>
      <div className="text-2xl font-semibold tracking-[-0.03em] tabular-nums truncate">{value}</div>
      {detail && <div className="text-[11px] text-[var(--text-faint)] mt-1.5 truncate">{detail}</div>}
    </div>
  );
}

function QuickAction({ to, icon: Icon, eyebrow, title, description, tone = 'primary' }) {
  const tones = {
    primary: 'from-[var(--primary)]/16 via-[var(--primary)]/6 to-transparent border-[var(--primary)]/22 text-[var(--primary)]',
    info: 'from-[var(--info)]/16 via-[var(--info)]/6 to-transparent border-[var(--info)]/22 text-[var(--info)]',
  };

  return (
    <Link
      to={to}
      className={cn(
        'group relative overflow-hidden rounded-2xl border bg-gradient-to-br p-4 md:p-5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[var(--shadow-elevated)]',
        tones[tone] || tones.primary
      )}
    >
      <div className="absolute -right-10 -top-10 h-28 w-28 rounded-full bg-current opacity-[0.045] blur-2xl transition-opacity group-hover:opacity-[0.08]" />
      <div className="relative z-10 flex items-start gap-3.5">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-current/20 bg-current/10 shadow-[inset_0_1px_0_rgb(255_255_255/0.06)]">
          <Icon size={18} />
        </span>
        <div className="min-w-0">
          <div className="text-[9px] font-semibold uppercase tracking-[0.16em] opacity-75">{eyebrow}</div>
          <div className="mt-1 text-sm font-semibold text-[var(--foreground)]">{title}</div>
          <div className="mt-1.5 text-[11px] leading-5 text-[var(--muted-foreground)]">{description}</div>
        </div>
      </div>
    </Link>
  );
}

function Panel({ title, icon: Icon, badge, children, className = '' }) {
  return (
    <section className={cn(
      'rounded-2xl border border-[var(--border-soft)] bg-[var(--card)]/88 shadow-[var(--shadow-panel)] overflow-hidden',
      className
    )}>
      <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-[var(--border-soft)]">
        <div className="flex items-center gap-2.5 min-w-0">
          {Icon && (
            <span className="w-8 h-8 rounded-lg bg-[var(--secondary)] flex items-center justify-center text-[var(--muted-foreground)] shrink-0">
              <Icon size={15} />
            </span>
          )}
          <h3 className="text-sm font-semibold truncate">{title}</h3>
        </div>
        {badge}
      </div>
      {children}
    </section>
  );
}

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
      api.get('/monitor/dashboard').catch(err => {
        if (!silent) setError({ code: getErrorCode(err) });
        return null;
      }),
      api.get('/streams').catch(() => []),
      api.get('/monitor/activity?limit=12').catch(() => []),
    ]);

    setStats(s);
    setStreams(Array.isArray(st) ? st : []);
    setActivities(Array.isArray(act) ? act : []);
    setLoading(false);
  }

  usePolling(() => load(true), 15000);

  const liveStreams = streams
    .filter(s => s.status === 'online')
    .sort((a, b) => (b.viewers || 0) - (a.viewers || 0));
  const offlineStreams = streams.filter(s => s.status !== 'online');
  const systemHealthy = Boolean(stats) && !error;

  if (loading) {
    return (
      <div>
        <div className="mb-7">
          <div className="h-3 w-32 rounded bg-[var(--secondary)] animate-pulse mb-3" />
          <div className="h-8 w-56 rounded bg-[var(--secondary)] animate-pulse" />
        </div>
        <CardSkeleton className="h-56 rounded-2xl mb-5" />
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.55fr)_minmax(340px,0.85fr)] gap-5">
          <CardSkeleton className="h-96 rounded-2xl" />
          <CardSkeleton className="h-96 rounded-2xl" />
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        eyebrow={t('common:dashboard.eyebrow')}
        title={t('common:dashboard.title')}
        subtitle={t('common:dashboard.subtitle')}
      />

      {error && <ErrorBanner message={t(`common:errors.${error.code}`)} onRetry={() => load()} />}

      <section className="mb-5 grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_280px]">
        <QuickAction
          to="/streams"
          icon={ArrowUpFromLine}
          eyebrow={t('common:dashboard.mvp.pushEyebrow')}
          title={t('common:dashboard.mvp.pushTitle')}
          description={t('common:dashboard.mvp.pushDescription')}
          tone="primary"
        />
        <QuickAction
          to="/forwarding"
          icon={ArrowDownToLine}
          eyebrow={t('common:dashboard.mvp.pullEyebrow')}
          title={t('common:dashboard.mvp.pullTitle')}
          description={t('common:dashboard.mvp.pullDescription')}
          tone="info"
        />
        <Link to="/releases" className="lux-panel group flex min-h-[118px] items-center justify-between gap-4 rounded-2xl p-4 md:p-5">
          <div>
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-[var(--text-faint)]">
              <Sparkles size={12} className="text-[var(--primary)]" />
              {t('common:dashboard.mvp.release')}
            </div>
            <div className="mt-2 text-xl font-semibold tracking-[-0.03em]">v{CURRENT_VERSION}</div>
            <div className="mt-1 text-[11px] text-[var(--muted-foreground)]">{t('common:dashboard.mvp.releaseHint')}</div>
          </div>
          <span className="rounded-xl border border-[var(--success)]/20 bg-[var(--success)]/10 px-2.5 py-1.5 text-[10px] font-semibold text-[var(--success)]">MVP</span>
        </Link>
      </section>

      <section className="relative overflow-hidden rounded-2xl border border-[var(--border-soft)] bg-[var(--panel)]/88 shadow-[var(--shadow-panel)] mb-5">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[var(--primary)]/55 to-transparent" />
        <div className="flex flex-wrap items-center justify-between gap-4 px-5 md:px-6 pt-5 pb-4">
          <div className="flex items-center gap-3">
            <span className={cn(
              'w-10 h-10 rounded-xl border flex items-center justify-center',
              systemHealthy
                ? 'bg-[var(--success)]/10 border-[var(--success)]/18 text-[var(--success)]'
                : 'bg-[var(--warning)]/10 border-[var(--warning)]/18 text-[var(--warning)]'
            )}>
              <Server size={18} />
            </span>
            <div>
              <p className="text-xs text-[var(--muted-foreground)]">{t('common:dashboard.systemStatus')}</p>
              <div className="flex items-center gap-2 mt-1">
                <span className={cn(
                  'w-2 h-2 rounded-full',
                  systemHealthy ? 'bg-[var(--success)]' : 'bg-[var(--warning)]'
                )} />
                <span className="text-sm font-semibold">
                  {t(systemHealthy ? 'common:dashboard.connected' : 'common:dashboard.degraded')}
                </span>
              </div>
            </div>
          </div>
          <div className="text-xs text-[var(--text-faint)]">
            15s polling · SRS Manager
          </div>
        </div>

        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 px-4 md:px-5 pb-5">
          <Metric
            icon={Radio}
            label={t('common:navigation.streams')}
            value={stats?.online_streams ?? liveStreams.length}
            detail={t('common:dashboard.online')}
            tone="success"
          />
          <Metric
            icon={Users}
            label={t('streams:columns.viewers')}
            value={stats?.total_viewers ?? 0}
            tone="info"
          />
          <Metric
            icon={Activity}
            label={t('streams:columns.bitrate')}
            value={formatBitrateKbps(stats?.total_bitrate || 0)}
            tone="primary"
          />
          <Metric
            icon={Satellite}
            label={t('common:dashboard.cdnActive')}
            value={`${stats?.active_channels ?? 0}/${stats?.total_channels ?? 0}`}
            detail={t('common:dashboard.activeTotal')}
            tone="warning"
          />
        </div>
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.55fr)_minmax(340px,0.85fr)] gap-5 items-start">
        <Panel
          title={t('common:dashboard.liveNow')}
          icon={Radio}
          badge={(
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--success)]/10 border border-[var(--success)]/15 px-2.5 py-1 text-[11px] font-medium text-[var(--success)]">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--success)]" />
              {liveStreams.length}
            </span>
          )}
        >
          {liveStreams.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <div className="w-11 h-11 mx-auto rounded-xl bg-[var(--secondary)] flex items-center justify-center text-[var(--muted-foreground)] mb-3">
                <Radio size={18} />
              </div>
              <p className="text-sm font-medium">{t('common:dashboard.noLive')}</p>
              {offlineStreams.length > 0 && (
                <p className="text-xs text-[var(--muted-foreground)] mt-1.5">
                  {t('common:dashboard.configuredOffline', { count: offlineStreams.length })}
                </p>
              )}
            </div>
          ) : (
            <div className="divide-y divide-[var(--border-soft)]">
              {liveStreams.map((s) => (
                <div key={s.id} className="group flex items-center justify-between gap-4 px-5 py-4 hover:bg-[var(--surface-hover)] transition-colors">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="relative flex h-2.5 w-2.5 shrink-0">
                      <span className="absolute inline-flex h-full w-full rounded-full bg-[var(--success)] opacity-30 animate-ping" />
                      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[var(--success)]" />
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-sm font-semibold truncate">{s.name}</span>
                        <span className="hidden sm:inline-flex text-[9px] font-semibold tracking-[0.12em] text-[var(--success)]">LIVE</span>
                      </div>
                      <div className="text-[11px] text-[var(--text-faint)] mt-1">
                        {s.protocol ? String(s.protocol).toUpperCase() : 'STREAM'}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-5 shrink-0 text-right">
                    <div>
                      <div className="text-sm font-semibold tabular-nums">{s.viewers || 0}</div>
                      <div className="text-[10px] text-[var(--text-faint)] mt-0.5">{t('streams:columns.viewers')}</div>
                    </div>
                    <div className="min-w-24 hidden sm:block">
                      <div className="text-sm font-medium tabular-nums">{formatBitrateKbps(s.bitrate)}</div>
                      <div className="text-[10px] text-[var(--text-faint)] mt-0.5">{t('streams:columns.bitrate')}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {offlineStreams.length > 0 && (
            <div className="px-5 py-3.5 border-t border-[var(--border-soft)] bg-[var(--background)]/18">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs text-[var(--muted-foreground)]">
                  {t('common:dashboard.configuredOffline', { count: offlineStreams.length })}
                </span>
                {offlineStreams[0]?.last_online_at && (
                  <span className="text-[10px] text-[var(--text-faint)]">
                    {offlineStreams[0].name}: {formatDateTime(offlineStreams[0].last_online_at)}
                  </span>
                )}
              </div>
            </div>
          )}
        </Panel>

        <div className="space-y-5">
          <Panel title={t('common:dashboard.distributionStatus')} icon={Satellite}>
            <div className="grid grid-cols-3 divide-x divide-[var(--border-soft)]">
              <div className="px-4 py-5 text-center">
                <Satellite size={15} className="mx-auto text-[var(--warning)] mb-2" />
                <div className="text-xl font-semibold tabular-nums">{stats?.active_channels ?? 0}</div>
                <div className="text-[10px] leading-tight text-[var(--text-faint)] mt-1.5">{t('common:dashboard.cdnActive')}</div>
              </div>
              <div className="px-4 py-5 text-center">
                <FileText size={15} className="mx-auto text-[var(--info)] mb-2" />
                <div className="text-xl font-semibold tabular-nums">{stats?.active_distribution_requests ?? 0}</div>
                <div className="text-[10px] leading-tight text-[var(--text-faint)] mt-1.5">{t('common:dashboard.distributions')}</div>
              </div>
              <div className="px-4 py-5 text-center">
                <ArrowLeftRight size={15} className="mx-auto text-[var(--primary)] mb-2" />
                <div className="text-xl font-semibold tabular-nums">{stats?.active_forward_tasks ?? 0}</div>
                <div className="text-[10px] leading-tight text-[var(--text-faint)] mt-1.5">{t('common:dashboard.routes')}</div>
              </div>
            </div>
          </Panel>

          <Panel title={t('common:dashboard.recentActivity')} icon={Activity}>
            {activities.length === 0 ? (
              <EmptyState title={t('common:page.emptyTitle')} />
            ) : (
              <div className="divide-y divide-[var(--border-soft)] max-h-[470px] overflow-y-auto">
                {activities.map((a, i) => {
                  const meta = ACTIVITY_ICONS[a.event_type] || ACTIVITY_ICONS.on_stop;
                  return (
                    <div key={`${a.processed_at || i}-${i}`} className="flex gap-3 px-5 py-3.5">
                      <span className="w-7 h-7 rounded-lg bg-[var(--secondary)] flex items-center justify-center shrink-0 mt-0.5">
                        <meta.icon size={13} className={meta.color} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs leading-relaxed">
                          <span className="font-semibold">{a.stream_name}</span>{' '}
                          <span className="text-[var(--muted-foreground)]">
                            {t(`common:dashboard.activity.${a.event_type}`, a.event_type)}
                          </span>
                        </p>
                        <p className="text-[10px] text-[var(--text-faint)] mt-1" title={a.processed_at}>
                          {formatRelativeTime(a.processed_at)}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
