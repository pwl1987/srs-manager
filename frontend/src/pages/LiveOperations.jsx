import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowRight, Plus, Search } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../lib/api';
import { usePolling } from '../lib/use-polling';
import { formatBitrateKbps, formatDuration } from '../i18n/format';
import { cn } from '../lib/utils';
import Modal from '../components/ui/Modal';
import ErrorBanner from '../components/ui/ErrorBanner';
import EmptyState from '../components/ui/EmptyState';
import { CardSkeleton } from '../components/ui/Skeleton';
import { btnPrimary, btnSecondary, btnGhost, inputClass, labelClass } from '../components/ui/styles';

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

function stateLabel(state) {
  return ({ ON_AIR: '正在播出', LIVE: '正在播出', CLOSING: '收播中', READY: '待开播', PREP: '准备中', ENDED: '已结束', 'OFF AIR': '未开播' })[state] || state || '未知';
}

function healthLabel(status) {
  return ({ HEALTHY: '运行正常', DEGRADED: '需要关注', CRITICAL: '需要处理', UNKNOWN: '待确认' })[status] || status || '待确认';
}

function Fact({ label, value, hint }) {
  return <div className="min-w-0"><div className="text-[9px] font-semibold tracking-[.12em] text-[var(--text-faint)]">{label}</div><div className="mt-1 truncate text-xs font-medium text-[var(--foreground)]">{value}</div>{hint && <div className="mt-0.5 truncate text-[10px] text-[var(--muted-foreground)]">{hint}</div>}</div>;
}

function RoomRow({ room, stream }) {
  const tone = toneFor(room);
  const state = room.session?.lifecycle_state || (room.program?.state === 'LIVE' ? 'LIVE' : 'OFF AIR');
  const required = Number(room.outputs?.required_total || 0);
  const healthy = Number(room.outputs?.required_healthy || 0);
  const streamName = stream?.name || room.room.name;
  return <Link to={'/streams/' + room.room.legacy_stream_id} className={cn(
    'grid gap-3 rounded-xl border bg-[var(--card)] px-4 py-3.5 shadow-[var(--shadow-panel)] transition-colors hover:border-[var(--border)] xl:grid-cols-[1.35fr_.9fr_.9fr_.9fr_.85fr_auto] xl:items-center',
    tone === 'danger' ? 'border-[var(--destructive)]/24' : tone === 'warning' ? 'border-[var(--warning)]/22' : 'border-[var(--border-soft)]'
  )}>
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-2"><Dot tone={tone}/><span className="truncate text-sm font-semibold">{room.room.name}</span><Badge tone={tone}>{stateLabel(state)}</Badge></div>
      <div className="mt-1.5 truncate text-[10px] text-[var(--muted-foreground)]">直播流：{streamName}{stream?.protocol ? ` · ${stream.protocol.toUpperCase()}` : ''}{room.session?.title ? ` · ${room.session.title}` : ''}</div>
    </div>
    <Fact label="节目" value={stateLabel(room.program?.state)} hint={room.program?.bitrate != null ? formatBitrateKbps(room.program.bitrate) : '尚无节目证据'} />
    <Fact label="会话" value={room.session?.started_at ? formatDuration(room.program?.uptime_seconds || 0) : '—'} hint={room.session?.preflight_status === 'PASS' ? '开播预检通过' : room.session?.preflight_status || '尚未创建本场直播'} />
    <Fact label="必需输出" value={required ? healthy + ' / ' + required : '—'} hint={required ? '当前运行正常数 / 必需总数' : '尚未配置必需输出'} />
    <Fact label="录制" value={room.outputs?.record_state || '未启动'} hint={room.program?.viewers != null ? String(room.program.viewers) + ' 人观看' : '暂无观看数据'} />
    <div className="justify-self-start xl:justify-self-end xl:text-right">
      <div className={cn('text-[11px] font-semibold', tone === 'danger' ? 'text-[var(--destructive)]' : tone === 'warning' ? 'text-[var(--warning)]' : tone === 'healthy' ? 'text-[var(--success)]' : 'text-[var(--muted-foreground)]')}>{healthLabel(room.health?.status)}</div>
      <div className="mt-1 inline-flex items-center gap-1 text-[10px] text-[var(--primary)]">{room.active_incidents ? `${room.active_incidents} 个待处理异常` : '进入工作台'}<ArrowRight size={11}/></div>
    </div>
  </Link>;
}

export function filterLiveRooms(rooms, streams, query, statusFilter = 'all') {
  const streamsById = Object.fromEntries((streams || []).map(stream => [String(stream.id), stream]));
  const q = String(query || '').trim().toLowerCase();
  return (rooms || []).filter(room => {
    const stream = streamsById[String(room.room.legacy_stream_id)];
    const onAir = room.session?.lifecycle_state === 'ON_AIR' || room.program?.state === 'LIVE' || stream?.status === 'online';
    const needsAttention = room.active_incidents > 0 || ['DEGRADED', 'CRITICAL'].includes(room.health?.status);
    const haystack = [
      room.room.name,
      stream?.name,
      stream?.protocol,
      stream?.status,
      onAir ? '正在直播 直播中 在线 on air online' : '空闲 未开播 离线 offline',
      needsAttention ? '需要处理 异常 degraded critical' : ''
    ].filter(Boolean).join(' ').toLowerCase();
    const matchesQuery = !q || haystack.includes(q);
    const matchesStatus = statusFilter === 'all'
      || (statusFilter === 'on_air' && onAir)
      || (statusFilter === 'attention' && needsAttention)
      || (statusFilter === 'idle' && !onAir);
    return matchesQuery && matchesStatus;
  });
}

export default function LiveOperations() {
  const [rooms, setRooms] = useState([]);
  const [streams, setStreams] = useState([]);
  const [external, setExternal] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', protocol: 'rtmp' });
  const [working, setWorking] = useState(false);

  async function load(silent = false) {
    if (!silent) setLoading(true);
    try {
      const [payload, live, streamList] = await Promise.all([
        api.get('/v3/rooms'),
        api.get('/streams/external-live').catch(() => []),
        api.get('/streams').catch(() => [])
      ]);
      setRooms(payload?.rooms || []);
      setExternal(Array.isArray(live) ? live : []);
      setStreams(Array.isArray(streamList) ? streamList : []);
      setError(null);
    } catch (err) { setError(err); }
    finally { if (!silent) setLoading(false); }
  }

  usePolling(() => load(Boolean(rooms.length)), 5000);

  const streamsById = useMemo(() => Object.fromEntries(streams.map(stream => [String(stream.id), stream])), [streams]);
  const filtered = useMemo(() => filterLiveRooms(rooms, streams, search, statusFilter), [rooms, streams, search, statusFilter]);

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
      <div><div className="text-[10px] font-semibold tracking-[.16em] text-[var(--primary)]">直播运维</div><h1 className="mt-1 text-2xl font-semibold tracking-[-.03em]">直播资源</h1><p className="mt-1 text-xs text-[var(--muted-foreground)]">按直播间、直播流、协议和运行状态查找，进入对应值守工作台。</p></div>
      <div className="flex flex-wrap gap-2"><label className="relative"><Search size={13} className="absolute left-3 top-3 text-[var(--text-faint)]"/><input value={search} onChange={e => setSearch(e.target.value)} className={cn(inputClass,'w-72 pl-9')} placeholder="搜索直播间、直播流、协议或状态"/></label><button className={btnPrimary} onClick={() => setOpen(true)}><Plus size={14}/>新建直播间</button></div>
    </div>

    <div className="mb-5 grid grid-cols-2 gap-2 md:grid-cols-5">
      {[
        ['正在播出', stats.onAir, 'text-[var(--success)]'],
        ['需要关注', stats.degraded, stats.degraded ? 'text-[var(--warning)]' : 'text-[var(--foreground)]'],
        ['未开播', stats.offAir, 'text-[var(--muted-foreground)]'],
        ['正在录制', stats.recording, stats.recording ? 'text-[var(--destructive)]' : 'text-[var(--foreground)]'],
        ['待处理异常', stats.incidents, stats.incidents ? 'text-[var(--warning)]' : 'text-[var(--foreground)]']
      ].map(([label,value,color]) => <div key={label} className="rounded-xl border border-[var(--border-soft)] bg-[var(--card)] px-4 py-3"><div className={cn('text-2xl font-semibold tabular-nums',color)}>{value}</div><div className="mt-1 text-[9px] font-semibold tracking-[.12em] text-[var(--text-faint)]">{label}</div></div>)}
    </div>

    {error && <ErrorBanner message={error.message || '无法读取直播运行态势'} onRetry={() => load()} />}
    {external.length > 0 && <div className="mb-4 flex items-center gap-3 rounded-xl border border-[var(--warning)]/20 bg-[var(--warning)]/6 px-4 py-3 text-xs text-[var(--muted-foreground)]"><AlertTriangle size={15} className="text-[var(--warning)]"/><span>检测到 {external.length} 路尚未登记的实时推流。需要先登记，之后才能进入统一直播资源列表。</span><Link className={btnSecondary} to="/streams-legacy">登记外部流</Link></div>}

    <div className="mb-4 flex flex-wrap items-center gap-2 border-b border-[var(--border-soft)] pb-3"><span className="mr-1 text-[10px] font-semibold tracking-[.08em] text-[var(--text-faint)]">快速筛选</span>{[['all', '全部'], ['on_air', '正在直播'], ['attention', '需要处理'], ['idle', '未开播']].map(([value, label]) => <button key={value} type="button" aria-pressed={statusFilter === value} onClick={() => setStatusFilter(value)} className={statusFilter === value ? btnSecondary : btnGhost}>{label}</button>)}<span className="ml-auto text-xs text-[var(--muted-foreground)]">{search.trim() || statusFilter !== 'all' ? `找到 ${filtered.length} / ${rooms.length} 个直播资源` : `${rooms.length} 个直播资源`}</span></div>

    {filtered.length ? <div className="space-y-2.5">{filtered.map(room => <RoomRow key={room.room.id} room={room} stream={streamsById[String(room.room.legacy_stream_id)]}/>)}</div> : <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--card)]"><EmptyState title={search.trim() || statusFilter !== 'all' ? '没有找到匹配的直播资源' : '尚未创建直播间'} description={search.trim() || statusFilter !== 'all' ? '可以换一个名称、协议或状态，或者清除筛选条件。' : '创建直播间后，从这里进入值守工作台。'} action={search.trim() || statusFilter !== 'all' ? <button className={btnSecondary} onClick={() => { setSearch(''); setStatusFilter('all'); }}>清除筛选</button> : <button className={btnPrimary} onClick={() => setOpen(true)}>创建直播间</button>}/></div>}

    <Modal open={open} onClose={() => setOpen(false)} title="新建直播间" footer={<><button className={btnSecondary} onClick={() => setOpen(false)}>取消</button><button form="room-create-form" className={btnPrimary} type="submit" disabled={working}>创建并继续配置</button></>}>
      <form id="room-create-form" onSubmit={createRoom} className="space-y-4"><div><label className={labelClass}>直播间名称</label><input className={inputClass} value={form.name} onChange={e => setForm({...form,name:e.target.value})} required placeholder="例如：晚间新闻、任意社会学"/><p className="mt-1.5 text-xs text-[var(--muted-foreground)]">名称用于之后查找直播间和直播流。</p></div><div><label className={labelClass}>默认接入协议</label><select className={inputClass} value={form.protocol} onChange={e => setForm({...form,protocol:e.target.value})}><option value="rtmp">RTMP</option><option value="srt">SRT</option></select><p className="mt-1.5 text-xs text-[var(--muted-foreground)]">创建后可在值守工作台继续配置输入来源、节目源和输出方式。</p></div></form>
    </Modal>
  </div>;
}
