import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  Activity, ArrowDown, ArrowLeft, ArrowRight, ArrowUpRight, Cable, CheckCircle2,
  CircleDot, Clock3, Copy, Eye, Film, Globe2, Network, Play, Radio,
  Server, ShieldAlert, Signal, Square, Users, WifiOff
} from 'lucide-react';
import { api } from '../lib/api';
import { cn } from '../lib/utils';
import { copyText } from '../lib/clipboard';
import { formatBitrateKbps, formatDuration, formatRelativeTime } from '../i18n/format';
import { getErrorCode } from '../lib/error-mapper';
import { usePolling } from '../lib/use-polling';
import {
  directRtmpUrl, displayUrl, resolvePullFlv, resolvePullHls
} from '../lib/stream-url-display';
import PageHeader from '../components/ui/PageHeader';
import ErrorBanner from '../components/ui/ErrorBanner';
import { CardSkeleton } from '../components/ui/Skeleton';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import StreamPreviewModal from '../components/streams/StreamPreviewModal';
import StreamQrModal from '../components/streams/StreamQrModal';
import DistributionSection from './StreamsDistribution';
import { btnPrimary, btnSecondary, btnDangerGhost, btnGhost } from '../components/ui/styles';

function StateBadge({ state, t }) {
  const meta = state === true
    ? ['bg-[var(--success-soft)] text-[var(--success)]', t('streams:workspace.state.live')]
    : state === false
      ? ['bg-[var(--secondary)] text-[var(--muted-foreground)]', t('streams:workspace.state.idle')]
      : ['bg-[var(--warning-soft)] text-[var(--warning)]', t('streams:workspace.state.unknown')];
  return <span className={cn('rounded-md px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em]', meta[0])}>{meta[1]}</span>;
}

function MetricCard({ icon: Icon, label, value, hint }) {
  return (
    <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--card)] px-4 py-3 shadow-[var(--shadow-panel)]">
      <div className="flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
        <Icon size={14} className="text-[var(--text-faint)]" />
        {label}
      </div>
      <div className="mt-2 text-xl font-semibold tracking-[-0.02em] tabular-nums">{value}</div>
      {hint && <div className="mt-1 text-[10px] text-[var(--text-faint)]">{hint}</div>}
    </div>
  );
}

function SourceTag({ children, kind = 'observed' }) {
  const classes = kind === 'observed'
    ? 'border-[var(--success)]/25 bg-[var(--success-soft)] text-[var(--success)]'
    : kind === 'configured'
      ? 'border-[var(--info)]/20 bg-[var(--info-soft)] text-[var(--info)]'
      : 'border-[var(--border-soft)] bg-[var(--secondary)] text-[var(--muted-foreground)]';
  return <span className={cn('rounded-md border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em]', classes)}>{children}</span>;
}

function FlowNode({ icon: Icon, eyebrow, title, state, children, tone = 'neutral' }) {
  const toneClass = tone === 'live'
    ? 'border-[var(--success)]/35 bg-[var(--success-soft)]/35'
    : tone === 'warning'
      ? 'border-[var(--warning)]/30 bg-[var(--warning-soft)]/30'
      : 'border-[var(--border-soft)] bg-[var(--card)]';
  return (
    <div className={cn('min-w-0 rounded-xl border p-4 shadow-[var(--shadow-panel)]', toneClass)}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--border-soft)] bg-[var(--background)]/55">
            <Icon size={17} />
          </div>
          <div className="min-w-0">
            <div className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[var(--text-faint)]">{eyebrow}</div>
            <div className="mt-1 truncate text-sm font-semibold">{title}</div>
          </div>
        </div>
        {state}
      </div>
      {children}
    </div>
  );
}

function EndpointRow({ label, value, onCopy }) {
  if (!value) return null;
  return (
    <div className="grid gap-2 border-b border-[var(--border-soft)] py-3 last:border-b-0 md:grid-cols-[96px_minmax(0,1fr)_auto] md:items-center">
      <span className="text-xs font-medium text-[var(--muted-foreground)]">{label}</span>
      <code className="min-w-0 break-all text-xs text-[var(--foreground)]">{value}</code>
      <button className={btnGhost} onClick={() => onCopy(value)} title="Copy"><Copy size={13} /></button>
    </div>
  );
}

function OutputSummary({ workspace, t }) {
  const forwards = workspace.outputs?.forwards || [];
  const cdn = workspace.outputs?.cdn_channels || [];
  const players = workspace.observed?.players?.count;

  return (
    <div className="grid gap-3 lg:grid-cols-3">
      <FlowNode
        icon={ArrowUpRight}
        eyebrow="OUT-PUSH"
        title={t('streams:workspace.outputs.forwarding')}
        state={<SourceTag kind="configured">{t('streams:workspace.source.configured')}</SourceTag>}
      >
        <div className="text-2xl font-semibold tabular-nums">{forwards.length}</div>
        <div className="mt-1 text-xs text-[var(--muted-foreground)]">{t('streams:workspace.outputs.forwardHint')}</div>
        {forwards.length > 0 && (
          <div className="mt-3 space-y-2">
            {forwards.slice(0, 3).map(task => (
              <div key={task.id} className="flex items-center justify-between gap-3 text-xs">
                <span className="min-w-0 truncate font-mono text-[var(--muted-foreground)]" title={task.target_url}>{task.target_url}</span>
                <span className={cn('shrink-0', task.enabled ? 'text-[var(--success)]' : 'text-[var(--text-faint)]')}>
                  {task.enabled ? t('streams:workspace.outputs.enabled') : t('streams:workspace.outputs.disabled')}
                </span>
              </div>
            ))}
          </div>
        )}
      </FlowNode>

      <FlowNode
        icon={Globe2}
        eyebrow="CDN"
        title={t('streams:workspace.outputs.cdn')}
        state={<SourceTag kind="configured">{t('streams:workspace.source.configured')}</SourceTag>}
      >
        <div className="text-2xl font-semibold tabular-nums">{cdn.length}</div>
        <div className="mt-1 text-xs text-[var(--muted-foreground)]">{t('streams:workspace.outputs.cdnHint')}</div>
        {cdn.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {cdn.slice(0, 4).map(channel => (
              <span key={channel.id} className={cn(
                'rounded-md px-2 py-1 text-[10px]',
                channel.remote_state === 'live' ? 'bg-[var(--success-soft)] text-[var(--success)]' :
                  channel.remote_state === 'unknown' ? 'bg-[var(--warning-soft)] text-[var(--warning)]' :
                    'bg-[var(--secondary)] text-[var(--muted-foreground)]'
              )}>
                {channel.channel_name} · {t(`streams:workspace.outputs.remote.${channel.remote_state}`)}
              </span>
            ))}
          </div>
        )}
      </FlowNode>

      <FlowNode
        icon={Eye}
        eyebrow="OUT-PULL"
        title={t('streams:workspace.outputs.pull')}
        state={workspace.observed?.clients_available
          ? <SourceTag>{t('streams:workspace.source.observed')}</SourceTag>
          : <SourceTag kind="unavailable">{t('streams:workspace.source.unavailable')}</SourceTag>}
      >
        <div className="text-2xl font-semibold tabular-nums">{players ?? '—'}</div>
        <div className="mt-1 text-xs text-[var(--muted-foreground)]">{t('streams:workspace.outputs.pullHint')}</div>
        <div className="mt-3 flex flex-wrap gap-1.5 text-[10px] text-[var(--muted-foreground)]">
          <span className="rounded-md bg-[var(--secondary)] px-2 py-1">HLS</span>
          <span className="rounded-md bg-[var(--secondary)] px-2 py-1">FLV</span>
          <span className="rounded-md bg-[var(--secondary)] px-2 py-1">RTMP</span>
        </div>
      </FlowNode>
    </div>
  );
}

export default function StreamWorkspace() {
  const { id } = useParams();
  const { t } = useTranslation(['streams', 'common']);
  const [workspace, setWorkspace] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [preview, setPreview] = useState(false);
  const [qr, setQr] = useState(false);
  const [confirmPublisher, setConfirmPublisher] = useState(false);
  const [confirmViewers, setConfirmViewers] = useState(false);
  const [working, setWorking] = useState(false);

  async function load(silent = false) {
    if (!silent) setLoading(true);
    if (!silent) setError(null);
    try {
      setWorkspace(await api.get(`/streams/${id}/workspace`));
    } catch (err) {
      if (!silent) setError({ code: getErrorCode(err) });
    } finally {
      setLoading(false);
    }
  }

  usePolling(() => load(Boolean(workspace)), 8000, Boolean(id));

  async function handleCopy(value) {
    if (!value) return;
    try {
      await copyText(value);
      toast.success(t('common:toasts.copied'));
    } catch {
      toast.error(t('common:errors.INTERNAL_GENERAL'));
    }
  }

  async function disconnectPublisher() {
    setWorking(true);
    try {
      const result = await api.post(`/streams/${id}/disconnect-publisher`);
      toast.success(t('streams:workspace.toasts.publisherDisconnected', { count: result?.disconnected || 0 }));
      setConfirmPublisher(false);
      await load(true);
    } catch (err) {
      toast.error(t(`common:errors.${getErrorCode(err)}`));
    } finally {
      setWorking(false);
    }
  }

  async function disconnectViewers() {
    setWorking(true);
    try {
      const result = await api.post(`/streams/${id}/disconnect-viewers`);
      toast.success(t('streams:workspace.toasts.viewersDisconnected', { count: result?.disconnected || 0 }));
      setConfirmViewers(false);
      await load(true);
    } catch (err) {
      toast.error(t(`common:errors.${getErrorCode(err)}`));
    } finally {
      setWorking(false);
    }
  }

  if (loading && !workspace) {
    return <div className="space-y-4"><CardSkeleton className="h-36" /><CardSkeleton className="h-64" /><CardSkeleton className="h-56" /></div>;
  }

  if (!workspace) {
    return (
      <div>
        {error && <ErrorBanner message={t(`common:errors.${error.code}`)} onRetry={() => load()} />}
        <Link to="/streams" className={btnSecondary}><ArrowLeft size={14} />{t('streams:workspace.back')}</Link>
      </div>
    );
  }

  const stream = workspace.stream;
  const observed = workspace.observed || {};
  const publisher = observed.publisher;
  const publishUrl = displayUrl(stream.push_url);
  const hlsUrl = resolvePullHls(stream);
  const flvUrl = resolvePullFlv(stream);
  const rtmpUrl = stream.pull_url_rtmp ? displayUrl(stream.pull_url_rtmp) : directRtmpUrl(stream.name);

  return (
    <div>
      <div className="mb-4">
        <Link to="/streams" className="inline-flex items-center gap-1.5 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
          <ArrowLeft size={13} />
          {t('streams:workspace.back')}
        </Link>
      </div>

      <PageHeader
        eyebrow={t('streams:workspace.eyebrow')}
        title={stream.name}
        subtitle={t('streams:workspace.subtitle')}
        actions={
          <>
            <StateBadge state={observed.online} t={t} />
            <button className={btnSecondary} onClick={() => setPreview(true)}><Play size={14} />{t('streams:actions.preview')}</button>
            <button className={btnSecondary} onClick={() => handleCopy(publishUrl)}><Copy size={14} />{t('streams:actions.copyPushUrl')}</button>
            {workspace.capabilities?.disconnect_publisher && (
              <button className={btnDangerGhost} onClick={() => setConfirmPublisher(true)}>
                <Square size={13} />
                {t('streams:workspace.controls.disconnectPublisher')}
              </button>
            )}
          </>
        }
      />

      {error && <ErrorBanner message={t(`common:errors.${error.code}`)} onRetry={() => load()} />}

      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon={Users} label={t('streams:columns.viewers')} value={observed.viewers ?? '—'} hint={t('streams:workspace.source.observed')} />
        <MetricCard icon={Activity} label={t('streams:columns.bitrate')} value={observed.online ? formatBitrateKbps(observed.bitrate) : '—'} hint={t('streams:workspace.source.observed')} />
        <MetricCard icon={Clock3} label={t('streams:columns.uptime')} value={observed.uptime_seconds ? formatDuration(observed.uptime_seconds) : '—'} hint={t('streams:workspace.source.observed')} />
        <MetricCard icon={Film} label={t('streams:transcode.label')} value={stream.transcode_template_name || t('streams:transcode.none')} hint={t('streams:workspace.source.configured')} />
      </div>

      <section className="mb-6 rounded-2xl border border-[var(--border-soft)] bg-[var(--panel)] p-4 shadow-[var(--shadow-panel)] md:p-5">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-faint)]">SIGNAL GRAPH</div>
            <h2 className="mt-1 text-base font-semibold">{t('streams:workspace.signal.title')}</h2>
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">{t('streams:workspace.signal.subtitle')}</p>
          </div>
          <div className="flex items-center gap-3 text-[10px] text-[var(--muted-foreground)]">
            <span className="inline-flex items-center gap-1"><CircleDot size={11} className="text-[var(--success)]" />{t('streams:workspace.source.observed')}</span>
            <span className="inline-flex items-center gap-1"><CircleDot size={11} className="text-[var(--info)]" />{t('streams:workspace.source.configured')}</span>
          </div>
        </div>

        <div className="grid items-stretch gap-3 xl:grid-cols-[minmax(240px,0.9fr)_44px_minmax(260px,0.9fr)_44px_minmax(0,1.4fr)]">
          <FlowNode
            icon={publisher ? Signal : WifiOff}
            eyebrow="INPUT · IN-PUSH"
            title={publisher ? t('streams:workspace.input.publisher') : t('streams:workspace.input.noPublisher')}
            tone={publisher ? 'live' : observed.srs_available === false ? 'warning' : 'neutral'}
            state={publisher
              ? <SourceTag>{t('streams:workspace.source.observed')}</SourceTag>
              : observed.srs_available === false
                ? <SourceTag kind="unavailable">{t('streams:workspace.source.unavailable')}</SourceTag>
                : null}
          >
            {publisher ? (
              <div className="space-y-1.5 text-xs text-[var(--muted-foreground)]">
                <div>{t('streams:workspace.input.publisherIp')} <span className="font-mono text-[var(--foreground)]">{publisher.ip || '—'}</span></div>
                <div>{t('streams:workspace.input.clientId')} <span className="font-mono text-[var(--foreground)]">{publisher.id}</span></div>
                <div>{t('streams:workspace.input.protocol')} <span className="uppercase text-[var(--foreground)]">{publisher.protocol || stream.protocol || '—'}</span></div>
              </div>
            ) : (
              <p className="text-xs leading-5 text-[var(--muted-foreground)]">
                {observed.srs_available === false ? t('streams:workspace.input.srsUnavailable') : t('streams:workspace.input.idleHint')}
              </p>
            )}
            <div className="mt-3 rounded-lg border border-dashed border-[var(--border-soft)] p-2.5 text-[10px] leading-4 text-[var(--text-faint)]">
              {t('streams:workspace.input.inPullUnavailable')}
            </div>
          </FlowNode>

          <div className="hidden items-center justify-center text-[var(--text-faint)] xl:flex"><ArrowRight size={18} /></div>

          <FlowNode
            icon={Server}
            eyebrow="STREAM CORE"
            title={stream.name}
            tone={observed.online ? 'live' : 'neutral'}
            state={<StateBadge state={observed.online} t={t} />}
          >
            <div className="space-y-2 text-xs text-[var(--muted-foreground)]">
              <div className="flex items-center justify-between gap-3"><span>{t('streams:workspace.core.protocol')}</span><span className="font-mono uppercase text-[var(--foreground)]">{stream.protocol || '—'}</span></div>
              <div className="flex items-center justify-between gap-3"><span>{t('streams:workspace.core.transcode')}</span><span className="truncate text-[var(--foreground)]">{stream.transcode_template_name || t('streams:transcode.none')}</span></div>
              <div className="flex items-center justify-between gap-3"><span>{t('streams:workspace.core.players')}</span><span className="tabular-nums text-[var(--foreground)]">{observed.players?.count ?? '—'}</span></div>
            </div>
          </FlowNode>

          <div className="hidden items-center justify-center text-[var(--text-faint)] xl:flex"><ArrowRight size={18} /></div>

          <div>
            <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-faint)]">
              <Network size={12} /> OUTPUTS
            </div>
            <OutputSummary workspace={workspace} t={t} />
          </div>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
        <div className="space-y-6">
          <section className="rounded-xl border border-[var(--border-soft)] bg-[var(--card)] p-4 shadow-[var(--shadow-panel)]">
            <div className="mb-2 flex items-center gap-2">
              <Cable size={15} className="text-[var(--info)]" />
              <h2 className="text-sm font-semibold">{t('streams:workspace.endpoints.title')}</h2>
            </div>
            <p className="mb-3 text-xs text-[var(--muted-foreground)]">{t('streams:workspace.endpoints.subtitle')}</p>
            <EndpointRow label={t('streams:workspace.endpoints.publish')} value={publishUrl} onCopy={handleCopy} />
            <EndpointRow label="HLS" value={hlsUrl} onCopy={handleCopy} />
            <EndpointRow label="FLV" value={flvUrl} onCopy={handleCopy} />
            <EndpointRow label="RTMP" value={rtmpUrl} onCopy={handleCopy} />
          </section>

          <section className="rounded-xl border border-[var(--border-soft)] bg-[var(--card)] p-4 shadow-[var(--shadow-panel)]">
            <DistributionSection stream={stream} />
          </section>
        </div>

        <div className="space-y-6">
          <section className="rounded-xl border border-[var(--border-soft)] bg-[var(--card)] p-4 shadow-[var(--shadow-panel)]">
            <div className="mb-4 flex items-center gap-2">
              <Activity size={15} className="text-[var(--primary)]" />
              <h2 className="text-sm font-semibold">{t('streams:workspace.activity.title')}</h2>
            </div>
            {workspace.activity?.length ? (
              <div className="space-y-3">
                {workspace.activity.map((event, index) => (
                  <div key={`${event.event_type}-${index}`} className="flex items-start gap-3">
                    <div className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--text-faint)]" />
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-medium">{t(`common:dashboard.activity.${event.event_type}`, event.event_type)}</div>
                      <div className="mt-0.5 text-[10px] text-[var(--text-faint)]">{formatRelativeTime(event.processed_at)}</div>
                    </div>
                  </div>
                ))}
              </div>
            ) : <p className="text-xs text-[var(--muted-foreground)]">{t('streams:workspace.activity.empty')}</p>}
            <p className="mt-4 border-t border-[var(--border-soft)] pt-3 text-[10px] leading-4 text-[var(--text-faint)]">
              {t('streams:workspace.activity.note')}
            </p>
          </section>

          <section className="rounded-xl border border-[var(--destructive)]/20 bg-[var(--destructive)]/5 p-4">
            <div className="flex items-start gap-3">
              <ShieldAlert size={17} className="mt-0.5 shrink-0 text-[var(--destructive)]" />
              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-semibold">{t('streams:workspace.danger.title')}</h2>
                <p className="mt-1 text-xs leading-5 text-[var(--muted-foreground)]">{t('streams:workspace.danger.description')}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    className={btnDangerGhost}
                    disabled={!workspace.capabilities?.disconnect_viewers}
                    onClick={() => setConfirmViewers(true)}
                  >
                    <Users size={14} />
                    {t('streams:workspace.controls.disconnectViewers')}
                  </button>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>

      <ConfirmDialog
        open={confirmPublisher}
        onClose={() => setConfirmPublisher(false)}
        onConfirm={disconnectPublisher}
        confirming={working}
        title={t('streams:workspace.confirm.publisherTitle')}
        description={t('streams:workspace.confirm.publisherDescription')}
        confirmLabel={t('streams:workspace.confirm.publisherConfirm')}
      />
      <ConfirmDialog
        open={confirmViewers}
        onClose={() => setConfirmViewers(false)}
        onConfirm={disconnectViewers}
        confirming={working}
        title={t('streams:workspace.confirm.viewersTitle')}
        description={t('streams:workspace.confirm.viewersDescription', { count: observed.players?.count ?? 0 })}
        confirmLabel={t('streams:workspace.confirm.viewersConfirm')}
      />

      <StreamPreviewModal stream={preview ? stream : null} onClose={() => setPreview(false)} t={t} />
      <StreamQrModal stream={qr ? stream : null} onClose={() => setQr(false)} t={t} onCopy={handleCopy} />
    </div>
  );
}
