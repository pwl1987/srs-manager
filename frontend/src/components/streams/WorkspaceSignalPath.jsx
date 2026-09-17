import { ArrowRight, Cable, Film, RadioTower, Server, Share2 } from 'lucide-react';
import { cn } from '../../lib/utils';

function Stage({ index, icon: Icon, title, subtitle, state, tone = 'neutral', children }) {
  const toneClass = tone === 'live'
    ? 'border-[var(--success)]/25 bg-[var(--success-soft)]/18'
    : tone === 'warning'
      ? 'border-[var(--warning)]/25 bg-[var(--warning-soft)]/16'
      : 'border-[var(--border-soft)] bg-[var(--card)]';
  return (
    <div className={cn('min-w-0 rounded-xl border p-3.5', toneClass)}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--secondary)] text-[var(--muted-foreground)]"><Icon size={15} /></span>
          <div className="min-w-0">
            <div className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[var(--text-faint)]">0{index}</div>
            <div className="mt-0.5 text-sm font-semibold">{title}</div>
            <div className="mt-0.5 text-[10px] text-[var(--muted-foreground)]">{subtitle}</div>
          </div>
        </div>
        {state}
      </div>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function Pill({ children, live = false, warning = false }) {
  return <span className={cn(
    'inline-flex rounded-md px-2 py-0.5 text-[9px] font-semibold',
    live ? 'bg-[var(--success-soft)] text-[var(--success)]' : warning ? 'bg-[var(--warning-soft)] text-[var(--warning)]' : 'bg-[var(--secondary)] text-[var(--muted-foreground)]'
  )}>{children}</span>;
}

export default function WorkspaceSignalPath({ workspace, t }) {
  const stream = workspace.stream;
  const observed = workspace.observed || {};
  const media = observed.media || {};
  const pull = workspace.inputs?.managed_pull || {};
  const task = pull.task;
  const managedObserved = Boolean(pull.observed_publisher);
  const publisher = observed.publisher;
  const inputMode = managedObserved ? 'IN-PULL' : publisher ? 'IN-PUSH' : task ? 'IN-PULL' : null;
  const inputName = managedObserved || task ? task?.source_name : publisher?.ip;
  const forwards = workspace.outputs?.forwards || [];
  const runningPushes = forwards.filter(item => item.runtime_state === 'RUNNING').length;
  const cdn = workspace.outputs?.cdn_channels || [];
  const liveCdn = cdn.filter(item => item.remote_state === 'live').length;
  const players = observed.players?.count ?? 0;
  const legacyTranscode = stream.transcode_template_name;

  return (
    <section className="rounded-2xl border border-[var(--border-soft)] bg-[var(--panel)]/65 p-4 shadow-[var(--shadow-panel)] md:p-5">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-faint)]">SIGNAL PATH</div>
          <h2 className="mt-1 text-base font-semibold">{t('streams:workspace.path.title')}</h2>
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">{t('streams:workspace.path.subtitle')}</p>
        </div>
        <div className="text-[10px] text-[var(--text-faint)]">{t('streams:workspace.path.evidenceNote')}</div>
      </div>

      <div className="grid gap-2 xl:grid-cols-[1fr_26px_1fr_26px_1fr_26px_1.15fr] xl:items-stretch">
        <Stage index={1} icon={RadioTower} title={t('streams:workspace.path.acquisition')} subtitle={t('streams:workspace.path.acquisitionHint')} tone={publisher ? 'live' : task ? 'warning' : 'neutral'} state={inputMode ? <Pill live={Boolean(publisher)} warning={!publisher}>{inputMode}</Pill> : null}>
          <div className="truncate text-sm font-medium">{inputName || t('streams:workspace.path.noInput')}</div>
          <div className="mt-1 text-[10px] text-[var(--muted-foreground)]">{publisher ? t('streams:workspace.path.publisherObserved') : task ? `${task.desired_state} · ${task.runtime_state}` : t('streams:workspace.path.awaitingAcquisition')}</div>
        </Stage>
        <div className="hidden items-center justify-center text-[var(--text-faint)] xl:flex"><ArrowRight size={15} /></div>

        <Stage index={2} icon={Server} title={t('streams:workspace.path.srsCore')} subtitle={t('streams:workspace.path.srsCoreHint')} tone={observed.online ? 'live' : 'neutral'} state={<Pill live={observed.online === true}>{observed.online === true ? 'OBSERVED' : 'IDLE'}</Pill>}>
          <div className="flex flex-wrap gap-1.5">
            <Pill>{media.video?.codec || 'VIDEO —'}</Pill>
            <Pill>{media.audio?.codec || 'AUDIO —'}</Pill>
            {media.video?.width && <Pill>{media.video.width}×{media.video.height}</Pill>}
          </div>
          <div className="mt-2 font-mono text-[10px] text-[var(--muted-foreground)]">{media.app || 'live'} / {stream.name}</div>
        </Stage>
        <div className="hidden items-center justify-center text-[var(--text-faint)] xl:flex"><ArrowRight size={15} /></div>

        <Stage index={3} icon={Film} title={t('streams:workspace.path.processing')} subtitle={t('streams:workspace.path.processingHint')} state={<Pill>{legacyTranscode ? 'LEGACY CONFIG' : 'PASSTHROUGH'}</Pill>}>
          <div className="text-sm font-medium">{legacyTranscode || t('streams:workspace.path.passthrough')}</div>
          <div className="mt-1 text-[10px] leading-4 text-[var(--muted-foreground)]">{legacyTranscode ? t('streams:workspace.path.legacyTranscodeNote') : t('streams:workspace.path.processingPending')}</div>
        </Stage>
        <div className="hidden items-center justify-center text-[var(--text-faint)] xl:flex"><ArrowRight size={15} /></div>

        <Stage index={4} icon={Share2} title={t('streams:workspace.path.distribution')} subtitle={t('streams:workspace.path.distributionHint')} tone={runningPushes || liveCdn || players ? 'live' : 'neutral'}>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg bg-[var(--background)]/28 px-2 py-2"><div className="text-lg font-semibold tabular-nums">{runningPushes}</div><div className="text-[9px] text-[var(--text-faint)]">OUT-PUSH</div></div>
            <div className="rounded-lg bg-[var(--background)]/28 px-2 py-2"><div className="text-lg font-semibold tabular-nums">{liveCdn}<span className="text-[10px] font-normal text-[var(--text-faint)]">/{cdn.length}</span></div><div className="text-[9px] text-[var(--text-faint)]">CDN</div></div>
            <div className="rounded-lg bg-[var(--background)]/28 px-2 py-2"><div className="text-lg font-semibold tabular-nums">{players}</div><div className="text-[9px] text-[var(--text-faint)]">OUT-PULL</div></div>
          </div>
          <div className="mt-2 flex items-center gap-1.5 text-[10px] text-[var(--muted-foreground)]"><Cable size={11} />{t('streams:workspace.path.guardsAttached')}</div>
        </Stage>
      </div>
    </section>
  );
}
