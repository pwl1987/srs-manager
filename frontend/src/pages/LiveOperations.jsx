import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowRight, Plus, Radio, Search, Video } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../lib/api';
import { usePolling } from '../lib/use-polling';
import { formatBitrateKbps, formatDuration } from '../i18n/format';
import { cn } from '../lib/utils';
import Modal from '../components/ui/Modal';
import ErrorBanner from '../components/ui/ErrorBanner';
import EmptyState from '../components/ui/EmptyState';
import { CardSkeleton } from '../components/ui/Skeleton';
import { btnPrimary, btnSecondary, inputClass, labelClass } from '../components/ui/styles';

function toneFor(room) {
  if (room.critical_incidents > 0 || room.health?.status === 'CRITICAL') return 'danger';
  if (room.active_incidents > 0 || room.health?.status === 'DEGRADED') return 'warning';
  if (room.session?.lifecycle_state === 'ON_AIR' || room.program?.state === 'LIVE') return 'healthy';
  return 'muted';
}

function Dot({ tone = 'muted' }) {
  const cls = tone === 'danger' ? 'bg-[var(--destructive)]'
    : tone === 'warning' ? 'bg-[var(--warning)]'
      : tone === 'healthy' ? 'bg-[var(--success)]'
        : 'bg-[var(--text-faint)]';
  return <span className={cn('inline-block h-2 w-2 shrink-0 rounded-full', cls)} />;
}

function Badge({ children, tone = 'muted' }) {
  const cls = tone === 'danger' ? 'border-[var(--destructive)]/20 bg-[var(--destructive)]/7 text-[var(--destructive)]'
    : tone === 'warning' ? 'border-[var(--warning)]/20 bg-[var(--warning)]/7 text-[var(--warning)]'
      : tone === 'healthy' ? 'border-[var(--success)]/20 bg-[var(--success-soft)] text-[var(--success)]'
        : 'border-[var(--border-soft)] bg-[var(--secondary)] text-[var(--muted-foreground)]';
  return <span className={cn('inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[9px] font-semibold uppercase tracking-[.08em]', cls)}>{children}</span>;
}

function Fact({ label, value, hint }) {
  return <div className="min-w-0"><div className="text-[9px] font-semibold uppercase tracking-[.12em] text-[var(--text-faint)]">{label}</div><div className="mt-1 truncate text-xs font-medium text-[var(--foreground)]">{value}</div>{hint && <div className="mt-0.5 truncate text-[10px] text-[var(--muted-foreground)]">{hint}</div>}</div>;
}

function RoomRow({ room }) {
  const tone = toneFor(room);
  const state = room.session?.lifecycle_state || (room.program?.state === 'LIVE' ? 'LIVE' : 'OFF AIR');
  const required = Number(room.outputs?.required_total || 0);
  const healthy = Number(room.outputs?.required_healthy || 0);
  return <Link to={'/streams/' + room.room.legacy_stream_id} className={cn(
    'grid gap-3 rounded-xl border bg-[var(--card)] px-4 py-3.5 shadow-[var(--shadow-panel)] transition-colors hover:border-[var(--border)] xl:grid-cols-[1.35fr_.9fr_.9fr_.9fr_.85fr_auto] xl:items-center',
    tone === 'danger' ? 'border-[var(--destructive)]/24' : tone === 'warning' ? 'border-[var(--warning)]/22' : 'border-[var(--border-soft)]'
  )}>
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-2"><Dot tone={tone}/><span className="truncate text-sm font-semibold">{room.room.name}</span><Badge tone={tone}>{state.replaceAll('_', ' ')}</Badge></div>
      <div className="mt-1.5 truncate text-[10px] text-[var(--muted-foreground)]">{room.session?.title || '当前无活动 Session'}</div>
    </div>
    <Fact label="PROGRAM" value={room.program?.state || 'UNKNOWN'} hint={room.program?.bitrate != null ? formatBitrateKbps(room.program.bitrate) : 'Evidence unknown'} />
    <Fact label="SESSION" value={room.session?.started_at ? formatDuration(room.program?.uptime_seconds || 0) : '—'} hint={room.session?.preflight_status || 'No active plan'} />
    <Fact label="REQUIRED" value={required ? healthy + ' / ' + required : '—'} hint={required ? 'Current runtime healthy' : 'No required outputs'} />
    <Fact label="RECORD" value={room.outputs?.record_state || 'STOPPED'} hint={room.program?.viewers != null ? String(room.program.viewers) + ' viewers' : 'Audience unknown'} />
    <div className="justify-self-start xl:justify-self-end xl:text-right">
      <div className={cn('text-[11px] font-semibold', tone === 'danger' ? 'text-[var(--destructive)]' : tone === 'warning' ? 'text-[var(--warning)]' : tone === 'healthy' ? 'text-[var(--success)]' : 'text-[var(--muted-foreground)]')}>{room.health?.status || 'UNKNOWN'}</div>
      <div className="mt-1 inline-flex items-center gap-1 text-[10px] text-[var(--primary)]">{room.active_incidents ? room.active_incidents + ' active incident' : '进入工作台'}<ArrowRight size={11}/></div>
    </div>
  </Link>;
}

export default function LiveOperations() {
  const [rooms, setRooms] = useState([]);
  const [external, setExternal] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', protocol: 'rtmp' });
  const [working, setWorking] = useState(false);

  async function load(silent = false) {
    if (!silent) setLoading(true);
    try {
      const [payload, live] = await Promise.all([
        api.get('/v3/rooms'),
        api.get('/streams/external-live').catch(() => [])
      ]);
      setRooms(payload?.rooms || []);
      setExternal(Array.isArray(live) ? live : []);
      setError(null);
    } catch (err) { setError(err); }
    finally { if (!silent) setLoading(false); }
  }

  usePolling(() => load(Boolean(rooms.length)), 5000);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? rooms.filter(room => room.room.name.toLowerCase().includes(q)) : rooms;
  }, [rooms, search]);

  const stats = useMemo(() => ({
    onAir: rooms.filter(r => r.session?.lifecycle_state === 'ON_AIR').length,
    degraded: rooms.filter(r => ['DEGRADED','CRITICAL'].includes(r.health?.status)).length,
    offAir: rooms.filter(r => !r.session && r.program?.state !== 'LIVE').length,
    recording: rooms.filter(r => ['RECORDING','FINALIZING'].includes(r.outputs?.record_state)).length,
    incidents: rooms.reduce((sum, r) => sum + Number(r.active_incidents || 0), 0)
  }), [rooms]);

  async function createRoom(event) {
    event.preventDefault();
    setWorking(true);
    try {
      await api.post('/streams', form);
      toast.success('直播间已创建');
      setOpen(false);
      setForm({ name: '', protocol: 'rtmp' });
      await load(true);
    } catch (err) { toast.error(err.message || '创建直播间失败'); }
    finally { setWorking(false); }
  }

  if (loading && !rooms.length) return <div className="space-y-3">{[1,2,3,4].map(x => <CardSkeleton key={x} className="h-24"/>)}</div>;

  return <div>
    <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
      <div><div className="text-[10px] font-semibold uppercase tracking-[.16em] text-[var(--primary)]">LIVE OPERATIONS</div><h1 className="mt-1 text-2xl font-semibold tracking-[-.03em]">直播间</h1><p className="mt-1 text-xs text-[var(--muted-foreground)]">所有直播间的实时运行态势。异常优先，正常保持安静。</p></div>
      <div className="flex gap-2"><label className="relative"><Search size={13} className="absolute left-3 top-3 text-[var(--text-faint)]"/><input value={search} onChange={e => setSearch(e.target.value)} className={cn(inputClass,'w-56 pl-9')} placeholder="搜索直播间"/></label><button className={btnPrimary} onClick={() => setOpen(true)}><Plus size={14}/>新建直播间</button></div>
    </div>

    <div className="mb-5 grid grid-cols-2 gap-2 md:grid-cols-5">
      {[
        ['ON AIR', stats.onAir, 'text-[var(--success)]'],
        ['DEGRADED', stats.degraded, stats.degraded ? 'text-[var(--warning)]' : 'text-[var(--foreground)]'],
        ['OFF AIR', stats.offAir, 'text-[var(--muted-foreground)]'],
        ['RECORDING', stats.recording, stats.recording ? 'text-[var(--destructive)]' : 'text-[var(--foreground)]'],
        ['ACTIVE INCIDENT', stats.incidents, stats.incidents ? 'text-[var(--warning)]' : 'text-[var(--foreground)]']
      ].map(([label,value,color]) => <div key={label} className="rounded-xl border border-[var(--border-soft)] bg-[var(--card)] px-4 py-3"><div className={cn('text-2xl font-semibold tabular-nums',color)}>{value}</div><div className="mt-1 text-[9px] font-semibold tracking-[.12em] text-[var(--text-faint)]">{label}</div></div>)}
    </div>

    {error && <ErrorBanner message={error.message || '无法读取直播运行态势'} onRetry={() => load()} />}
    {external.length > 0 && <div className="mb-4 flex items-center gap-3 rounded-xl border border-[var(--warning)]/20 bg-[var(--warning)]/6 px-4 py-3 text-xs text-[var(--muted-foreground)]"><AlertTriangle size={15} className="text-[var(--warning)]"/><span>检测到 {external.length} 路尚未登记的实时 Publisher。进入兼容管理页完成登记。</span><Link className={btnSecondary} to="/streams-legacy">处理</Link></div>}

    {filtered.length ? <div className="space-y-2.5">{filtered.map(room => <RoomRow key={room.room.id} room={room}/>)}</div> : <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--card)]"><EmptyState title={search ? '没有匹配的直播间' : '尚未创建直播间'} description={search ? undefined : '创建直播间后，从这里进入值守工作台。'} action={search ? undefined : <button className={btnPrimary} onClick={() => setOpen(true)}>创建直播间</button>}/></div>}

    <Modal open={open} onClose={() => setOpen(false)} title="新建直播间" footer={<><button className={btnSecondary} onClick={() => setOpen(false)}>取消</button><button form="room-create-form" className={btnPrimary} type="submit" disabled={working}>创建</button></>}>
      <form id="room-create-form" onSubmit={createRoom} className="space-y-4"><div><label className={labelClass}>直播间名称</label><input className={inputClass} value={form.name} onChange={e => setForm({...form,name:e.target.value})} required placeholder="例如：晚间新闻"/></div><div><label className={labelClass}>主接入协议</label><select className={inputClass} value={form.protocol} onChange={e => setForm({...form,protocol:e.target.value})}><option value="rtmp">RTMP</option><option value="srt">SRT</option></select></div></form>
    </Modal>
  </div>;
}
