import React from 'react';
import { useState } from 'react';
import { ArrowLeft, QrCode, Settings2, Users, Video, Gauge, Cable, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '../../lib/utils';
import { formatBitrateKbps, formatDuration } from '../../i18n/format';
import { btnGhost } from '../ui/styles';
import SessionCommandBar from './SessionCommandBar';
import WorkspaceInputRackV3 from './WorkspaceInputRackV3';
import WorkspacePreviewPanel from './WorkspacePreviewPanel';
import SourcePreviewPane from './SourcePreviewPane';
import V3OutputRack from './V3OutputRack';
import WorkspaceSignalRouteV3 from './WorkspaceSignalRouteV3';
import OperationsDock from './OperationsDock';

const STATE_LABELS = {
  NORMAL: '运行正常',
  LIVE: '正在播出',
  DEGRADED: '已降级',
  WARNING: '有警告',
  CRITICAL: '严重异常',
  CLOSING: '收播中',
  UNKNOWN: '待确认'
};

function Badge({ state, label }) {
  const normal = state === 'NORMAL' || state === 'LIVE';
  const warn = state === 'DEGRADED' || state === 'WARNING' || state === 'CLOSING';
  const critical = state === 'CRITICAL';
  const cls = normal ? 'bg-[var(--success-soft)] text-[var(--success)]'
    : warn ? 'bg-[var(--warning-soft)] text-[var(--warning)]'
      : critical ? 'bg-[var(--destructive)]/10 text-[var(--destructive)]'
        : 'bg-[var(--secondary)] text-[var(--muted-foreground)]';
  return <span className={cn('rounded-md px-2 py-1 text-[9px] font-semibold tracking-[.04em]',cls)}>{label || STATE_LABELS[state] || state || STATE_LABELS.UNKNOWN}</span>;
}

function Metric({ icon:Icon, label, value }) {
  return <div className="min-w-0 rounded-lg border border-[var(--border-soft)] bg-[var(--background)]/22 px-2.5 py-2">
    <div className="flex items-center gap-1.5 text-[8px] font-semibold uppercase tracking-[.1em] text-[var(--text-faint)]"><Icon size={10}/>{label}</div>
    <div className="mt-1 truncate text-xs font-semibold tabular-nums">{value}</div>
  </div>;
}

function MediaFacts({ media }) {
  const video=media?.video || {};
  const audio=media?.audio || {};
  return <div className="grid grid-cols-2 gap-2">
    <div className="rounded-lg border border-[var(--border-soft)] bg-[var(--background)]/22 p-2.5"><div className="text-[8px] font-semibold tracking-[.1em] text-[var(--text-faint)]">视频</div><div className="mt-1 text-[10px] font-medium">{video.codec || '—'}{video.width ? ' · ' + video.width + '×' + video.height : ''}</div></div>
    <div className="rounded-lg border border-[var(--border-soft)] bg-[var(--background)]/22 p-2.5"><div className="text-[8px] font-semibold tracking-[.1em] text-[var(--text-faint)]">音频</div><div className="mt-1 text-[10px] font-medium">{audio.codec || '—'}{audio.sample_rate ? ' · ' + Math.round(audio.sample_rate/1000) + 'kHz' : ''}{audio.channels ? ' · ' + audio.channels + 'ch' : ''}</div></div>
  </div>;
}

export function Drawer({ title, eyebrow, onClose, children, wide=false }) {
  return <div className="fixed inset-0 z-50 flex justify-end bg-black/45" onClick={onClose}>
    <aside className={cn('h-full w-full overflow-y-auto border-l border-[var(--border)] bg-[var(--card)] shadow-2xl',wide ? 'max-w-[860px]' : 'max-w-[720px]')} onClick={event => event.stopPropagation()}>
      <div className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-[var(--border-soft)] bg-[var(--card)] px-5">
        <div><div className="text-[9px] font-semibold tracking-[.14em] text-[var(--text-faint)]">{eyebrow}</div><div className="mt-0.5 text-sm font-semibold">{title}</div></div>
        <button className={btnGhost} onClick={onClose}><X size={14}/></button>
      </div>
      <div className="space-y-4 p-5">{children}</div>
    </aside>
  </div>;
}

export default function WorkspaceControlSurfaceV3({
  stream, observed, media, v3Workspace, sourcePreview, outputScenes, incidentState,
  sourceDrawerContent, advancedDrawerContent, onPreviewSource, onQr, onChanged, t, readOnlyHarness = false, initialDrawer = null
}) {
  const [drawer,setDrawer] = useState(initialDrawer);
  const health=v3Workspace?.health?.status || (observed?.online ? 'NORMAL' : 'UNKNOWN');
  const workers=Object.values(v3Workspace?.evidence?.workers || {});
  const availableWorkers=workers.filter(item => item?.available).length;
  const incidents=incidentState?.active || [];
  const noSession=!v3Workspace?.session;
  const programSource = (v3Workspace?.sources || []).find(source => source.id === v3Workspace?.program?.source_id);
  const programSourceName = programSource?.name || (v3Workspace?.program?.source_id ? '节目源待确认' : '节目来源待确认');

  return <div data-workspace-region="root" className={cn('flex h-full min-h-0 flex-col bg-[var(--background)]',noSession ? 'overflow-y-auto' : 'overflow-hidden')}>
    <div data-workspace-region="global" className="flex min-h-8 shrink-0 items-center justify-between border-b border-[var(--border-soft)] bg-[var(--panel)]/78 px-3 text-[9px] text-[var(--muted-foreground)]">
      <div className="flex min-w-0 items-center gap-3"><Link to="/streams" className="inline-flex items-center gap-1 text-[var(--foreground)] hover:text-[var(--primary)]"><ArrowLeft size={11}/>返回直播流</Link><span className="hidden sm:inline">直播间 · {stream.name}</span><Badge state={health}/><span className="hidden lg:inline">工作进程 {availableWorkers}/{workers.length || '—'}</span></div>
      <div className="flex items-center gap-2"><span className="hidden md:inline tabular-nums">{new Date().toLocaleTimeString()}</span>{incidents.length > 0 && <Badge state="WARNING" label={String(incidents.length) + ' 个告警'}/>}<button className={btnGhost} onClick={onQr} title="显示二维码"><QrCode size={11}/></button><button className={btnGhost} onClick={() => setDrawer('advanced')}><Settings2 size={11}/>高级控制</button></div>
    </div>

    <div data-workspace-region="session" className="shrink-0 px-2 pt-2"><SessionCommandBar compact readOnly={readOnlyHarness} roomId={v3Workspace?.room?.id || ('room:' + stream.id)} workspace={v3Workspace} onChanged={onChanged}/></div>

    <div data-workspace-region="main" className="grid min-h-0 flex-1 grid-cols-1 xl:grid-cols-[18%_48%_34%] 2xl:grid-cols-[20%_47%_33%]">
      <div data-workspace-region="input" className="min-h-[300px] min-w-0 xl:min-h-0">
        <WorkspaceInputRackV3 workspace={v3Workspace} previewingSourceId={sourcePreview?.source_id} onPreview={onPreviewSource} onManage={() => setDrawer('sources')}/>
      </div>

      <section data-workspace-region="program" className="min-h-[440px] min-w-0 overflow-y-auto bg-[var(--background)] p-2 xl:min-h-0">
        <div className="mb-2 flex items-center justify-between gap-2"><div><div className="text-[9px] font-semibold tracking-[.14em] text-[var(--text-faint)]">节目控制</div><div className="mt-0.5 text-[10px] text-[var(--muted-foreground)]">{programSourceName}</div></div><Badge state={v3Workspace?.program?.state || 'UNKNOWN'}/></div>
        <div className={sourcePreview ? 'grid gap-2 xl:grid-cols-[68%_32%]' : 'grid grid-cols-1'}>
          <WorkspacePreviewPanel stream={stream} observed={observed} t={t}/>
          {sourcePreview && <SourcePreviewPane preview={sourcePreview} onClose={() => onPreviewSource(null)}/>}
        </div>
        <div className="mt-2 grid grid-cols-4 gap-2">
          <Metric icon={Users} label="观看人数" value={observed?.players?.count ?? '—'}/>
          <Metric icon={Gauge} label="码率" value={observed?.online ? formatBitrateKbps(observed.bitrate) : '—'}/>
          <Metric icon={Cable} label="输出" value={(v3Workspace?.outputs || []).length}/>
          <Metric icon={Video} label="已播时长" value={observed?.uptime_seconds != null ? formatDuration(observed.uptime_seconds) : '—'}/>
        </div>
        <div className="mt-2 [@media(max-height:850px)]:hidden"><MediaFacts media={media}/></div>
      </section>

      <div data-workspace-region="outputs" className="min-h-[360px] min-w-0 overflow-y-auto border-l border-[var(--border-soft)] bg-[var(--card)]/55 xl:min-h-0">
        <V3OutputRack embedded roomId={v3Workspace?.room?.id || ('room:' + stream.id)} workspace={v3Workspace} scenes={outputScenes} onChanged={onChanged}/>
      </div>
    </div>

    <WorkspaceSignalRouteV3 workspace={v3Workspace}/>
    <OperationsDock compact embedded roomId={v3Workspace?.room?.id || ('room:' + stream.id)} workspace={v3Workspace} incidentState={incidentState} onChanged={onChanged}/>

    {drawer === 'sources' && <Drawer title="输入来源" eyebrow="INPUT / ACQUISITION" onClose={() => setDrawer(null)}>{sourceDrawerContent}</Drawer>}
    {drawer === 'advanced' && <Drawer title="高级运行控制" eyebrow="COMPATIBILITY / ENGINEERING" wide onClose={() => setDrawer(null)}>{advancedDrawerContent}</Drawer>}
  </div>;
}
