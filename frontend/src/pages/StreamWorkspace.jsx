import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  Activity, ArrowLeft, Cable, Clock3, Copy, Gauge, QrCode,
  ShieldAlert, Square, Users, Video, Volume2
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
import IngestCredentialPanel from '../components/streams/IngestCredentialPanel';
import ManagedPushPanel from '../components/streams/ManagedPushPanel';
import OutPullAccessPanel from '../components/streams/OutPullAccessPanel';
import WorkspacePreviewPanel from '../components/streams/WorkspacePreviewPanel';
import SourcePreviewPane from '../components/streams/SourcePreviewPane';
import WorkspaceSignalPath from '../components/streams/WorkspaceSignalPath';
import TranscodePipelinePanel from '../components/streams/TranscodePipelinePanel';
import V3OutputRack from '../components/streams/V3OutputRack';
import SessionCommandBar from '../components/streams/SessionCommandBar';
import OperationsDock from '../components/streams/OperationsDock';
import WorkspaceControlSurfaceV3 from '../components/streams/WorkspaceControlSurfaceV3';
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
  const [sourcePreview, setSourcePreview] = useState(null);
  const [sourcePreviewLoading, setSourcePreviewLoading] = useState(false);
  const [ingestCredentials, setIngestCredentials] = useState([]);
  const [v3Workspace, setV3Workspace] = useState(null);
  const [outputScenes, setOutputScenes] = useState([]);
  const [incidentState, setIncidentState] = useState({ active: [], recent: [] });

  async function load(silent = false) {
    if (!silent) setLoading(true);
    if (!silent) setError(null);
    try {
      const [nextWorkspace, ingest, nextV3Workspace, nextIncidents] = await Promise.all([
        api.get(`/streams/${id}/workspace`),
        api.get(`/v3/rooms/room:${id}/ingest-credentials`).catch(() => ({ credentials: [] })),
        api.get(`/v3/rooms/room:${id}/workspace`).catch(() => null),
        api.get(`/v3/rooms/room:${id}/incidents`).catch(() => ({ active: [], recent: [] }))
      ]);
      setWorkspace(nextWorkspace);
      setIngestCredentials(ingest?.credentials || []);
      setV3Workspace(nextV3Workspace);
      setIncidentState(nextIncidents || { active: [], recent: [] });
    }
    catch (err) { if (!silent) setError({ code: getErrorCode(err) }); }
    finally { setLoading(false); }
  }

  useEffect(() => {
    let active = true;
    api.get('/v3/output/scenes').then(data => { if (active) setOutputScenes(data?.scenes || []); }).catch(() => {});
    return () => { active = false; };
  }, []);

  usePolling(() => load(Boolean(workspace)), 2000, Boolean(id));

  async function handleCopy(value) {
    if (!value) return;
    try { await copyText(value); toast.success(t('common:toasts.copied')); }
    catch { toast.error(t('common:errors.INTERNAL_GENERAL')); }
  }

  async function previewSource(source) {
    if (!source?.v3_source_id || sourcePreviewLoading) return;
    setSourcePreviewLoading(true);
    try {
      const access = await api.post(`/v3/rooms/room:${stream.id}/sources/${encodeURIComponent(source.v3_source_id)}/preview-access`);
      setSourcePreview({ ...access, source_name: source.source_name, source_id: source.v3_source_id });
    } catch (err) {
      toast.error(err?.message || t('common:errors.INTERNAL_GENERAL'));
    } finally {
      setSourcePreviewLoading(false);
    }
  }

  async function previewV3Source(source) {
    if (!source?.id) { setSourcePreview(null); return; }
    if (sourcePreviewLoading) return;
    setSourcePreviewLoading(true);
    try {
      const access = await api.post(`/v3/rooms/room:${id}/sources/${encodeURIComponent(source.id)}/preview-access`);
      setSourcePreview({ ...access, source_name: source.name, source_id: source.id });
    } catch (err) {
      toast.error(err?.message || t('common:errors.INTERNAL_GENERAL'));
    } finally {
      setSourcePreviewLoading(false);
    }
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
    <>
      <WorkspaceControlSurfaceV3
        stream={stream}
        observed={observed}
        media={media}
        v3Workspace={v3Workspace}
        sourcePreview={sourcePreview}
        outputScenes={outputScenes}
        incidentState={incidentState}
        onPreviewSource={previewV3Source}
        onQr={() => setQr(true)}
        onChanged={() => load(true)}
        t={t}
        sourceDrawerContent={<>
          <IngestCredentialPanel stream={stream} credentials={ingestCredentials} onChanged={() => load(true)} />
          <ManagedPullPanel workspace={workspace} stream={stream} t={t} onChanged={() => load(true)} onPreviewSource={previewSource} previewingSourceId={sourcePreview?.source_id} />
        </>}
        advancedDrawerContent={<>
          <div className="rounded-xl border border-[var(--warning)]/18 bg-[var(--warning)]/5 p-3 text-[10px] leading-5 text-[var(--muted-foreground)]">兼容 / 工程层控制，不属于 V3 正常值守路径。Runtime 事实仍来自同一批 Worker / Policy。</div>
          <TranscodePipelinePanel workspace={workspace} stream={stream} t={t} onChanged={() => load(true)} />
          <ManagedPushPanel workspace={workspace} stream={stream} t={t} onChanged={() => load(true)} />
          <OutPullAccessPanel workspace={workspace} stream={stream} t={t} onChanged={() => load(true)} onDisconnectViewers={() => setConfirmViewers(true)} />
          <section className="rounded-xl border border-[var(--border-soft)] bg-[var(--card)] p-4"><DistributionSection stream={stream} /></section>
          <section className="rounded-xl border border-[var(--border-soft)] bg-[var(--card)] p-4">
            <div className="mb-2 text-[10px] font-semibold tracking-[.12em] text-[var(--text-faint)]">ENDPOINTS</div>
            {!ingestCredentials.length && <EndpointRow label="PUBLISH" value={publishUrl} onCopy={handleCopy} />}
            <EndpointRow label="HLS" value={hlsUrl} onCopy={handleCopy} />
            <EndpointRow label="FLV" value={flvUrl} onCopy={handleCopy} />
            <EndpointRow label="RTMP" value={rtmpUrl} onCopy={handleCopy} />
            <p className="mt-3 text-[10px] leading-5 text-[var(--warning)]">Direct SRS HLS 不受当前 on_play admission 控制；公网保护必须由反向代理/CDN 承担。</p>
          </section>
          <section className="rounded-xl border border-[var(--destructive)]/18 bg-[var(--destructive)]/4 p-4">
            <div className="text-xs font-semibold">Danger Zone</div>
            <div className="mt-3 flex flex-wrap gap-2">
              {canDisconnectPublisher && <button className={btnDangerGhost} onClick={() => setConfirmPublisher(true)}><Square size={12} />{t('streams:workspace.controls.disconnectPublisher')}</button>}
              <button className={btnDangerGhost} disabled={!workspace.capabilities?.disconnect_viewers} onClick={() => setConfirmViewers(true)}><Users size={12} />{t('streams:workspace.controls.disconnectViewers')}</button>
            </div>
          </section>
        </>}
      />
      <ConfirmDialog open={confirmPublisher} onClose={() => setConfirmPublisher(false)} onConfirm={disconnectPublisher} confirming={working} title={t('streams:workspace.confirm.publisherTitle')} description={t('streams:workspace.confirm.publisherDescription')} confirmLabel={t('streams:workspace.confirm.publisherConfirm')} />
      <ConfirmDialog open={confirmViewers} onClose={() => setConfirmViewers(false)} onConfirm={disconnectViewers} confirming={working} title={t('streams:workspace.confirm.viewersTitle')} description={t('streams:workspace.confirm.viewersDescription', { count: observed.players?.count ?? 0 })} confirmLabel={t('streams:workspace.confirm.viewersConfirm')} />
      <StreamQrModal stream={qr ? stream : null} onClose={() => setQr(false)} t={t} onCopy={handleCopy} />
    </>
  );
}
