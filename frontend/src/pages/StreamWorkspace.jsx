import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  Activity, ArrowLeft, Cable, Clock3, Copy, Film, Gauge, QrCode,
  Settings2, ShieldAlert, Square, Users, Video, Volume2
} from 'lucide-react';
import { api } from '../lib/api';
import { cn } from '../lib/utils';
import { copyText } from '../lib/clipboard';
import { formatBitrateKbps, formatDuration, formatRelativeTime } from '../i18n/format';
import { getErrorCode } from '../lib/error-mapper';
import { usePolling } from '../lib/use-polling';
import { displayUrl, resolvePullFlv, resolvePullHls } from '../lib/stream-url-display';
import PageHeader from '../components/ui/PageHeader';
import ErrorBanner from '../components/ui/ErrorBanner';
import { CardSkeleton } from '../components/ui/Skeleton';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import StreamQrModal from '../components/streams/StreamQrModal';
import ManagedPullPanel from '../components/streams/ManagedPullPanel';
import ManagedPushPanel from '../components/streams/ManagedPushPanel';
import OutPullAccessPanel from '../components/streams/OutPullAccessPanel';
import WorkspacePreviewPanel from '../components/streams/WorkspacePreviewPanel';
import WorkspaceSignalPath from '../components/streams/WorkspaceSignalPath';
import DistributionSection from './StreamsDistribution';
import { btnSecondary, btnDangerGhost, btnGhost } from '../components/ui/styles';

function StateBadge({ state, t }) {
  const meta = state === true
    ? ['bg-[var(--success-soft)] text-[var(--success)]', t('streams:workspace.state.live')]
    : state === false
      ? ['bg-[var(--secondary)] text-[var(--muted-foreground)]', t('streams:workspace.state.idle')]
      : ['bg-[var(--warning-soft)] text-[var(--warning)]', t('streams:workspace.state.unknown')];
  return <span className={cn('rounded-md px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em]', meta[0])}>{meta[1]}</span>;
}

function RuntimeMetric({ icon: Icon, label, value, hint }) {
  return (
    <div className="rounded-xl bg-[var(--background)]/26 p-3.5">
      <div className="flex items-center gap-2 text-[10px] font-medium text-[var(--muted-foreground)]"><Icon size={13} className="text-[var(--text-faint)]" />{label}</div>
      <div className="mt-2 text-xl font-semibold tracking-[-0.02em] tabular-nums">{value}</div>
      {hint && <div className="mt-1 truncate text-[9px] text-[var(--text-faint)]" title={hint}>{hint}</div>}
    </div>
  );
}

function MediaEvidence({ media, t }) {
  const video = media?.video || {};
  const audio = media?.audio || {};
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--background)]/22 p-3">
        <div className="flex items-center gap-2 text-[10px] text-[var(--text-faint)]"><Video size={12} />{t('streams:workspace.console.media')}</div>
        <div className="mt-1.5 text-sm font-medium">{video.codec || '—'} {video.width ? `· ${video.width}×${video.height}` : ''}</div>
        <div className="mt-1 text-[10px] text-[var(--muted-foreground)]">{video.profile || '—'}{video.level ? ` · L${video.level}` : ''}</div>
      </div>
      <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--background)]/22 p-3">
        <div className="flex items-center gap-2 text-[10px] text-[var(--text-faint)]"><Volume2 size={12} />AUDIO</div>
        <div className="mt-1.5 text-sm font-medium">{audio.codec || '—'} {audio.sample_rate ? `· ${(audio.sample_rate / 1000).toFixed(audio.sample_rate % 1000 ? 1 : 0)} kHz` : ''}</div>
        <div className="mt-1 text-[10px] text-[var(--muted-foreground)]">{audio.channels ? `${audio.channels} ch` : '—'}{audio.profile ? ` · ${audio.profile}` : ''}</div>
      </div>
    </div>
  );
}

function EndpointRow({ label, value, onCopy }) {
  if (!value) return null;
  return (
    <div className="grid gap-2 border-b border-[var(--border-soft)] py-3 last:border-b-0 md:grid-cols-[76px_minmax(0,1fr)_auto] md:items-center">
      <span className="text-xs font-medium text-[var(--muted-foreground)]">{label}</span>
      <code className="min-w-0 break-all text-[11px] text-[var(--foreground)]">{value}</code>
      <button className={btnGhost} onClick={() => onCopy(value)} title="Copy"><Copy size={13} /></button>
    </div>
  );
}

function ProcessingPanel({ stream, t }) {
  const legacy = stream.transcode_template_name;
  return (
    <section className="rounded-xl border border-[var(--border-soft)] bg-[var(--card)] p-4 shadow-[var(--shadow-panel)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2"><Film size={15} className="text-[var(--info)]" /><h2 className="text-sm font-semibold">{t('streams:workspace.processing.title')}</h2></div>
          <p className="mt-1 text-xs leading-5 text-[var(--muted-foreground)]">{t('streams:workspace.processing.subtitle')}</p>
        </div>
        <Link to="/transcode" className={btnSecondary}><Settings2 size={13} />{t('common:navigation.transcode')}</Link>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-[var(--success)]/18 bg-[var(--success-soft)]/14 p-3">
          <div className="text-[10px] font-semibold text-[var(--success)]">PASSTHROUGH</div>
          <div className="mt-1 text-sm font-medium">{t('streams:workspace.processing.passthroughTitle')}</div>
          <p className="mt-1 text-[10px] leading-4 text-[var(--muted-foreground)]">{t('streams:workspace.processing.passthroughHint')}</p>
        </div>
        <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--background)]/22 p-3">
          <div className="text-[10px] font-semibold text-[var(--text-faint)]">{t('streams:workspace.processing.legacyConfigured')}</div>
          <div className="mt-1 text-sm font-medium">{legacy || '—'}</div>
          <p className="mt-1 text-[10px] leading-4 text-[var(--muted-foreground)]">{legacy ? t('streams:workspace.processing.legacyHint') : t('streams:workspace.processing.next')}</p>
        </div>
      </div>
    </section>
  );
}

export default function StreamWorkspace() {
  const { id } = useParams();
  const { t } = useTranslation(['streams', 'common']);
  const [workspace, setWorkspace] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [qr, setQr] = useState(false);
  const [confirmPublisher, setConfirmPublisher] = useState(false);
  const [confirmViewers, setConfirmViewers] = useState(false);
  const [working, setWorking] = useState(false);

  async function load(silent = false) {
    if (!silent) setLoading(true);
    if (!silent) setError(null);
    try { setWorkspace(await api.get(`/streams/${id}/workspace`)); }
    catch (err) { if (!silent) setError({ code: getErrorCode(err) }); }
    finally { setLoading(false); }
  }

  usePolling(() => load(Boolean(workspace)), 2000, Boolean(id));

  async function handleCopy(value) {
    if (!value) return;
    try { await copyText(value); toast.success(t('common:toasts.copied')); }
    catch { toast.error(t('common:errors.INTERNAL_GENERAL')); }
  }

  async function disconnectPublisher() {
    setWorking(true);
    try {
      const result = await api.post(`/streams/${id}/disconnect-publisher`);
      toast.success(t('streams:workspace.toasts.publisherDisconnected', { count: result?.disconnected || 0 }));
      setConfirmPublisher(false);
      await load(true);
    } catch (err) { toast.error(t(`common:errors.${getErrorCode(err)}`)); }
    finally { setWorking(false); }
  }

  async function disconnectViewers() {
    setWorking(true);
    try {
      const result = await api.post(`/streams/${id}/disconnect-viewers`);
      toast.success(t('streams:workspace.toasts.viewersDisconnected', { count: result?.disconnected || 0 }));
      setConfirmViewers(false);
      await load(true);
    } catch (err) { toast.error(t(`common:errors.${getErrorCode(err)}`)); }
    finally { setWorking(false); }
  }

  if (loading && !workspace) return <div className="space-y-4"><CardSkeleton className="h-72" /><CardSkeleton className="h-52" /><CardSkeleton className="h-80" /></div>;
  if (!workspace) return <div>{error && <ErrorBanner message={t(`common:errors.${error.code}`)} onRetry={() => load()} />}<Link to="/streams" className={btnSecondary}><ArrowLeft size={14} />{t('streams:workspace.back')}</Link></div>;

  const stream = workspace.stream;
  const observed = workspace.observed || {};
  const media = observed.media || {};
  const publisher = observed.publisher;
  const managedPull = workspace.inputs?.managed_pull || {};
  const managedTask = managedPull.task;
  const managedDesiredRunning = managedTask?.desired_state === 'RUNNING';
  const managedObserved = Boolean(managedPull.observed_publisher);
  const inputSummary = managedObserved ? managedTask?.source_name : publisher?.ip || managedTask?.source_name || t('streams:workspace.path.noInput');
  const activePushes = (workspace.outputs?.forwards || []).filter(item => item.runtime_state === 'RUNNING').length;
  const liveCdn = (workspace.outputs?.cdn_channels || []).filter(item => item.remote_state === 'live').length;
  const distributionCount = activePushes + liveCdn + (observed.players?.count || 0);
  const publishUrl = displayUrl(stream.push_url);
  const hlsUrl = resolvePullHls(stream);
  const flvUrl = resolvePullFlv(stream);
  const rtmpUrl = stream.pull_url_rtmp ? displayUrl(stream.pull_url_rtmp) : publishUrl;
  const canDisconnectPublisher = workspace.capabilities?.disconnect_publisher && !managedDesiredRunning;

  return (
    <div>
      <div className="mb-4"><Link to="/streams" className="inline-flex items-center gap-1.5 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)]"><ArrowLeft size={13} />{t('streams:workspace.back')}</Link></div>
      <PageHeader
        eyebrow={t('streams:workspace.eyebrow')}
        title={stream.name}
        subtitle={t('streams:workspace.subtitle')}
        actions={<>
          <StateBadge state={observed.online} t={t} />
          <button className={btnSecondary} onClick={() => setQr(true)}><QrCode size={14} />{t('streams:actions.qrcode')}</button>
          <button className={btnSecondary} onClick={() => handleCopy(publishUrl)}><Copy size={14} />{t('streams:actions.copyPushUrl')}</button>
          {canDisconnectPublisher && <button className={btnDangerGhost} onClick={() => setConfirmPublisher(true)}><Square size={13} />{t('streams:workspace.controls.disconnectPublisher')}</button>}
        </>}
      />
      {error && <ErrorBanner message={t(`common:errors.${error.code}`)} onRetry={() => load()} />}

      <section className="mb-5 grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(360px,0.65fr)]">
        <WorkspacePreviewPanel stream={stream} observed={observed} t={t} />
        <div className="rounded-2xl border border-[var(--border-soft)] bg-[var(--card)] p-4 shadow-[var(--shadow-panel)] md:p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-faint)]">{t('streams:workspace.console.title')}</div>
              <div className="mt-1 text-sm font-semibold">{inputSummary}</div>
              <p className="mt-1 text-[10px] leading-4 text-[var(--muted-foreground)]">{t('streams:workspace.console.subtitle')}</p>
            </div>
            <StateBadge state={observed.online} t={t} />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <RuntimeMetric icon={Users} label={t('streams:workspace.console.viewers')} value={observed.players?.count ?? '—'} hint={t('streams:workspace.source.observed')} />
            <RuntimeMetric icon={Gauge} label={t('streams:columns.bitrate')} value={observed.online ? formatBitrateKbps(observed.bitrate) : '—'} hint={t('streams:workspace.source.observed')} />
            <RuntimeMetric icon={Clock3} label={t('streams:columns.uptime')} value={observed.uptime_seconds != null ? formatDuration(observed.uptime_seconds) : '—'} hint={t('streams:workspace.source.observed')} />
            <RuntimeMetric icon={Cable} label={t('streams:workspace.console.distribution')} value={distributionCount} hint={`${activePushes} push · ${liveCdn} CDN · ${observed.players?.count || 0} pull`} />
          </div>
          <div className="mt-3"><MediaEvidence media={media} t={t} /></div>
        </div>
      </section>

      <div className="mb-6"><WorkspaceSignalPath workspace={workspace} t={t} /></div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(330px,0.8fr)]">
        <div className="space-y-6">
          <ManagedPullPanel workspace={workspace} stream={stream} t={t} onChanged={() => load(true)} />
          <ProcessingPanel stream={stream} t={t} />
          <ManagedPushPanel workspace={workspace} stream={stream} t={t} onChanged={() => load(true)} />
          <OutPullAccessPanel workspace={workspace} stream={stream} t={t} onChanged={() => load(true)} onDisconnectViewers={() => setConfirmViewers(true)} />
          <section className="rounded-xl border border-[var(--border-soft)] bg-[var(--card)] p-4 shadow-[var(--shadow-panel)]"><DistributionSection stream={stream} /></section>
        </div>

        <div className="space-y-6">
          <section className="rounded-xl border border-[var(--border-soft)] bg-[var(--card)] p-4 shadow-[var(--shadow-panel)]">
            <div className="mb-2 flex items-center gap-2"><Cable size={15} className="text-[var(--info)]" /><h2 className="text-sm font-semibold">{t('streams:workspace.endpoints.title')}</h2></div>
            <p className="mb-3 text-xs text-[var(--muted-foreground)]">{t('streams:workspace.endpoints.subtitle')}</p>
            <EndpointRow label={t('streams:workspace.endpoints.publish')} value={publishUrl} onCopy={handleCopy} />
            <EndpointRow label="HLS" value={hlsUrl} onCopy={handleCopy} />
            <EndpointRow label="FLV" value={flvUrl} onCopy={handleCopy} />
            <EndpointRow label="RTMP" value={rtmpUrl} onCopy={handleCopy} />
          </section>

          <section className="rounded-xl border border-[var(--border-soft)] bg-[var(--card)] p-4 shadow-[var(--shadow-panel)]">
            <div className="mb-4 flex items-center gap-2"><Activity size={15} className="text-[var(--primary)]" /><h2 className="text-sm font-semibold">{t('streams:workspace.activity.title')}</h2></div>
            {workspace.activity?.length ? <div className="space-y-3">{workspace.activity.map((event, index) => <div key={`${event.event_type}-${index}`} className="flex items-start gap-3"><div className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--text-faint)]" /><div className="min-w-0 flex-1"><div className="text-xs font-medium">{t(`common:dashboard.activity.${event.event_type}`, event.event_type)}</div><div className="mt-0.5 text-[10px] text-[var(--text-faint)]">{formatRelativeTime(event.processed_at)}</div></div></div>)}</div> : <p className="text-xs text-[var(--muted-foreground)]">{t('streams:workspace.activity.empty')}</p>}
            <p className="mt-4 border-t border-[var(--border-soft)] pt-3 text-[10px] leading-4 text-[var(--text-faint)]">{t('streams:workspace.activity.note')}</p>
          </section>

          <section className="rounded-xl border border-[var(--destructive)]/18 bg-[var(--destructive)]/4 p-4">
            <div className="flex items-start gap-3"><ShieldAlert size={17} className="mt-0.5 shrink-0 text-[var(--destructive)]" /><div className="min-w-0 flex-1"><h2 className="text-sm font-semibold">{t('streams:workspace.danger.title')}</h2><p className="mt-1 text-xs leading-5 text-[var(--muted-foreground)]">{managedDesiredRunning ? t('streams:workspace.danger.managedPullDescription') : t('streams:workspace.danger.description')}</p><div className="mt-3"><button className={btnDangerGhost} disabled={!workspace.capabilities?.disconnect_viewers} onClick={() => setConfirmViewers(true)}><Users size={14} />{t('streams:workspace.controls.disconnectViewers')}</button></div></div></div>
          </section>
        </div>
      </div>

      <ConfirmDialog open={confirmPublisher} onClose={() => setConfirmPublisher(false)} onConfirm={disconnectPublisher} confirming={working} title={t('streams:workspace.confirm.publisherTitle')} description={t('streams:workspace.confirm.publisherDescription')} confirmLabel={t('streams:workspace.confirm.publisherConfirm')} />
      <ConfirmDialog open={confirmViewers} onClose={() => setConfirmViewers(false)} onConfirm={disconnectViewers} confirming={working} title={t('streams:workspace.confirm.viewersTitle')} description={t('streams:workspace.confirm.viewersDescription', { count: observed.players?.count ?? 0 })} confirmLabel={t('streams:workspace.confirm.viewersConfirm')} />
      <StreamQrModal stream={qr ? stream : null} onClose={() => setQr(false)} t={t} onCopy={handleCopy} />
    </div>
  );
}
