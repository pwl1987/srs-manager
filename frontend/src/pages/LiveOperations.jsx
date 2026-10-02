import React, { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, ArrowRight, Plus, RefreshCw, Search } from 'lucide-react';
import { api } from '../lib/api';
import { usePolling } from '../lib/use-polling';
import { formatBitrateKbps, formatDuration } from '../i18n/format';
import { cn } from '../lib/utils';
import ErrorBanner from '../components/ui/ErrorBanner';
import EmptyState from '../components/ui/EmptyState';
import { CardSkeleton } from '../components/ui/Skeleton';
import { btnPrimary, btnSecondary, btnGhost, inputClass } from '../components/ui/styles';
import RoomCommandPanel from '../components/streams/RoomCommandPanel';
import CreateRoomWizard from '../components/streams/CreateRoomWizard';
import {
  DIRECTION_IDS,
  directionIdsFromRoomSummary,
  getDirection,
  roomMatchesDirection
} from '../lib/directions';
import {
  ROOM_BUCKETS,
  projectRoomPresentation,
  roomMatchesBucket,
  TONE_BADGE_CLASS,
  TONE_DOT_CLASS,
  TONE_ROW_CLASS
} from '../lib/room-presentation';
import { highlightSegments, matchesSearch } from '../lib/search-text';
import { handleListKeyDown, nextSelectedRoomId } from '../lib/wizard-flow';

// Search synonyms carry both languages so a zh or en query finds rooms by
// status/direction intent; names are matched directly.
const BUCKET_SYNONYMS = {
  running: '正在直播 直播中 在线 正常运行 on air online live running',
  attention: '需要关注 需要处理 异常 attention degraded warning',
  fault: '故障 报错 fault critical error',
  idle: '空闲 未开播 离线 offline idle'
};

const DIRECTION_SYNONYMS = {
  IN_PUSH: '第三方推给我们 推流接入 in push',
  IN_PULL: '我们主动拉第三方 拉流 in pull',
  OUT_PUSH: '我们推给第三方 外推 out push',
  OUT_PULL: '第三方拉我们的输出 对外拉流 out pull',
  RECORD: '本地输出 录制 record'
};

const BUCKET_FILTER_KEYS = {
  all: 'streams:liveOps.filter.statusAll',
  running: 'streams:roomState.running',
  attention: 'streams:roomState.attention',
  fault: 'streams:roomState.fault',
  idle: 'streams:roomState.idle'
};

function Highlight({ text, query }) {
  if (!text) return null;
  return <>{highlightSegments(text, query).map((segment, index) => segment.hit
    ? <mark key={index} className="rounded bg-[var(--primary)]/25 px-0.5 text-[var(--foreground)]">{segment.text}</mark>
    : <span key={index}>{segment.text}</span>)}</>;
}

function DirectionChips({ room, t }) {
  const ids = directionIdsFromRoomSummary(room);
  return <div className="mt-1.5 flex flex-wrap items-center gap-1">
    {ids.map(id => {
      const direction = getDirection(id);
      const Icon = direction.icon;
      return <span key={id} className="inline-flex items-center gap-1 rounded-md border border-[var(--border-soft)] bg-[var(--secondary)]/60 px-1.5 py-0.5 text-[9px] text-[var(--muted-foreground)]"><Icon size={10} />{t(direction.labelKey)}</span>;
    })}
  </div>;
}

function Fact({ label, value, hint }) {
  return <div className="min-w-0"><div className="text-[9px] font-semibold tracking-[.12em] text-[var(--text-faint)]">{label}</div><div className="mt-1 truncate text-xs font-medium text-[var(--foreground)]">{value}</div>{hint && <div className="mt-0.5 truncate text-[10px] text-[var(--muted-foreground)]">{hint}</div>}</div>;
}

export function filterLiveRooms(rooms, streams, query, statusFilter = 'all', directionFilter = 'all') {
  const streamsById = Object.fromEntries((streams || []).map(stream => [String(stream.id), stream]));
  return (rooms || []).filter(room => {
    const stream = streamsById[String(room.room.legacy_stream_id)];
    const presentation = projectRoomPresentation(room);
    const directions = directionIdsFromRoomSummary(room);
    const haystack = [
      room.room.name,
      room.room.remark,
      room.room.business_unit,
      stream?.name,
      stream?.protocol,
      stream?.status,
      BUCKET_SYNONYMS[presentation.bucket] || '',
      ...directions.map(id => DIRECTION_SYNONYMS[id] || '')
    ].filter(Boolean).join(' ');
    const matchesQuery = !String(query || '').trim() || matchesSearch(haystack, query);
    return matchesQuery
      && roomMatchesBucket(room, statusFilter)
      && roomMatchesDirection(room, directionFilter);
  });
}

export async function loadLiveOperations() {
  const [payload, live, streamList] = await Promise.all([
    api.get('/v3/rooms'),
    api.get('/streams/external-live').catch(() => []),
    api.get('/streams').catch(() => [])
  ]);
  return {
    rooms: payload?.rooms || [],
    external: Array.isArray(live) ? live : [],
    streams: Array.isArray(streamList) ? streamList : []
  };
}

export function applyLiveOperationsResult(result, setters) {
  setters.setRooms(result.rooms);
  setters.setExternal(result.external);
  setters.setStreams(result.streams);
}

export async function refreshLiveOperations({ silent = false, setLoading, setRooms, setExternal, setStreams, setError }) {
  if (!silent) setLoading(true);
  try {
    const result = await loadLiveOperations();
    applyLiveOperationsResult(result, { setRooms, setExternal, setStreams });
    setError(null);
  } catch (err) { setError(err); }
  finally { if (!silent) setLoading(false); }
}

function RoomRow({ room, stream, selected, query, onSelect, onOpen, t }) {
  const presentation = projectRoomPresentation(room);
  const required = Number(room.outputs?.required_total || 0);
  const healthy = Number(room.outputs?.required_healthy || 0);
  const configured = Number(room.outputs?.configured_total || 0);
  const inputs = room.inputs || {};
  const legacyOpen = (inputs.push_credentials || 0) === 0 && (inputs.pull_tasks || 0) === 0;
  const inputSummary = legacyOpen
    ? t('streams:liveOps.input.legacyOpen')
    : [
      inputs.push_credentials ? t('streams:liveOps.input.pushCredentials', { count: inputs.push_credentials }) : '',
      inputs.pull_tasks ? t('streams:liveOps.input.pullTasks', { count: inputs.pull_tasks }) : ''
    ].filter(Boolean).join(' · ');
  const streamName = stream?.name || room.room.name;

  return <div
    role="button"
    tabIndex={0}
    aria-pressed={selected}
    onClick={() => onSelect(room)}
    onDoubleClick={() => onOpen(room)}
    onKeyDown={event => { if (event.key === 'Enter') onOpen(room); }}
    className={cn(
      'grid cursor-pointer gap-3 rounded-xl border bg-[var(--card)] px-4 py-3.5 shadow-[var(--shadow-panel)] transition-colors hover:border-[var(--border)] xl:grid-cols-[minmax(0,1.5fr)_minmax(0,.72fr)_minmax(0,.72fr)_minmax(0,.72fr)_auto] xl:items-center',
      TONE_ROW_CLASS[presentation.tone],
      selected && 'border-[var(--primary)]/50 bg-[var(--primary)]/5'
    )}
  >
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn('inline-block h-2 w-2 shrink-0 rounded-full', TONE_DOT_CLASS[presentation.tone])} />
        <span className="truncate text-sm font-semibold"><Highlight text={room.room.name} query={query} /></span>
        <span className={cn('inline-flex items-center rounded-md border px-2 py-1 text-[9px] font-semibold uppercase tracking-[.08em]', TONE_BADGE_CLASS[presentation.tone])}>{t(presentation.labelKey)}</span>
      </div>
      <div className="mt-1 truncate text-[10px] text-[var(--muted-foreground)]">
        <Highlight text={streamName} query={query} />{stream?.protocol ? ` · ${stream.protocol.toUpperCase()}` : ''}{room.room.business_unit ? ` · ${room.room.business_unit}` : ''}{room.room.remark ? ` · ${room.room.remark}` : ''}
      </div>
      <DirectionChips room={room} t={t} />
    </div>
    <Fact label={t('streams:liveOps.columns.input')} value={inputSummary} hint={t('streams:liveOps.input.hint')} />
    <Fact
      label={t('streams:liveOps.columns.outputs')}
      value={configured ? String(configured) : '—'}
      hint={required ? t('streams:liveOps.outputs.requiredHint', { healthy, total: required }) : t('streams:liveOps.outputs.noneHint')}
    />
    <Fact
      label={t('streams:liveOps.columns.duration')}
      value={room.program?.uptime_seconds != null ? formatDuration(room.program.uptime_seconds) : '—'}
      hint={room.program?.viewers != null ? t('streams:liveOps.audienceAndBitrate', { count: room.program.viewers, bitrate: formatBitrateKbps(room.program.bitrate) }) : undefined}
    />
    <div className="flex items-center justify-start gap-2 xl:justify-end">
      <button
        type="button"
        className={btnSecondary}
        onClick={event => { event.stopPropagation(); onOpen(room); }}
      >
        {t('streams:liveOps.enterWorkspace')}<ArrowRight size={12} />
      </button>
    </div>
  </div>;
}

export default function LiveOperations({
  initialRooms = null,
  initialStreams = null,
  initialExternal = null,
  initialLoading = true,
  initialError = null,
  initialSearch = '',
  initialStatusFilter = 'all',
  initialDirectionFilter = 'all',
  initialSelectedRoomId = null,
  initialOpen = false,
  initialForm = { name: '', protocol: 'rtmp' }
} = {}) {
  const { t } = useTranslation(['streams', 'common']);
  const navigate = useNavigate();
  const seeded = initialRooms !== null;
  const [rooms, setRooms] = useState(initialRooms || []);
  const [streams, setStreams] = useState(initialStreams || []);
  const [external, setExternal] = useState(initialExternal || []);
  const [loading, setLoading] = useState(seeded ? initialLoading : true);
  const [error, setError] = useState(initialError);
  const [search, setSearch] = useState(initialSearch);
  const [statusFilter, setStatusFilter] = useState(initialStatusFilter);
  const [directionFilter, setDirectionFilter] = useState(initialDirectionFilter);
  const [selectedRoomId, setSelectedRoomId] = useState(initialSelectedRoomId);
  const [open, setOpen] = useState(initialOpen);

  usePolling(() => refreshLiveOperations({
    silent: Boolean(rooms.length), setLoading, setRooms, setExternal, setStreams, setError
  }), 5000, !seeded);

  const streamsById = useMemo(() => Object.fromEntries(streams.map(stream => [String(stream.id), stream])), [streams]);
  const filtered = useMemo(() => filterLiveRooms(rooms, streams, search, statusFilter, directionFilter), [rooms, streams, search, statusFilter, directionFilter]);
  const selectedRoom = useMemo(
    () => filtered.find(room => room.room.id === selectedRoomId) || rooms.find(room => room.room.id === selectedRoomId) || null,
    [filtered, rooms, selectedRoomId]
  );

  const stats = useMemo(() => {
    const byBucket = { running: 0, attention: 0, fault: 0, idle: 0 };
    for (const room of rooms) byBucket[projectRoomPresentation(room).bucket] += 1;
    return {
      ...byBucket,
      recording: rooms.filter(r => ['RECORDING', 'FINALIZING'].includes(r.outputs?.record_state)).length,
      incidents: rooms.reduce((sum, r) => sum + Number(r.active_incidents || 0), 0)
    };
  }, [rooms]);

  async function manualRefresh() {
    await refreshLiveOperations({ setLoading, setRooms, setExternal, setStreams, setError });
  }

  function openWorkspace(room) {
    navigate(`/streams/${room.room.legacy_stream_id}`);
  }

  function moveSelection(step) {
    const nextId = nextSelectedRoomId(filtered, selectedRoomId, step);
    if (nextId) setSelectedRoomId(nextId);
  }

  function onListKeyDown(event) {
    handleListKeyDown(event, {
      moveSelection,
      openWorkspace: () => { if (selectedRoom) openWorkspace(selectedRoom); }
    });
  }

  if (loading && !rooms.length) return <div className="space-y-3">{[1, 2, 3, 4].map(x => <CardSkeleton key={x} className="h-24" />)}</div>;

  const hasFilter = Boolean(search.trim()) || statusFilter !== 'all' || directionFilter !== 'all';

  return <div className="min-h-0">
    <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
      <div>
        <div className="text-[10px] font-semibold tracking-[.16em] text-[var(--primary)]">{t('streams:liveOps.eyebrow')}</div>
        <h1 className="mt-1 text-2xl font-semibold tracking-[-.03em]">{t('streams:liveOps.title')}</h1>
        <p className="mt-1 text-xs text-[var(--muted-foreground)]">{t('streams:liveOps.subtitle')}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <label className="relative">
          <Search size={13} className="absolute left-3 top-3 text-[var(--text-faint)]" />
          <input value={search} onChange={e => setSearch(e.target.value)} className={cn(inputClass, 'w-72 pl-9')} placeholder={t('streams:liveOps.searchPlaceholder')} aria-label={t('streams:liveOps.searchPlaceholder')} />
        </label>
        <button type="button" className={btnSecondary} onClick={manualRefresh} disabled={loading} title={t('streams:liveOps.refresh')}>
          <RefreshCw size={14} className={loading ? 'animate-spin' : undefined} />
          {t('streams:liveOps.refresh')}
        </button>
        <button className={btnPrimary} onClick={() => setOpen(true)}><Plus size={14} />{t('streams:liveOps.create')}</button>
      </div>
    </div>

    <div className="mb-5 grid grid-cols-2 gap-2 md:grid-cols-6">
      {[
        ['streams:roomState.running', stats.running, 'text-[var(--success)]'],
        ['streams:roomState.attention', stats.attention, stats.attention ? 'text-[var(--warning)]' : 'text-[var(--foreground)]'],
        ['streams:roomState.fault', stats.fault, stats.fault ? 'text-[var(--destructive)]' : 'text-[var(--foreground)]'],
        ['streams:roomState.idle', stats.idle, 'text-[var(--muted-foreground)]'],
        ['streams:liveOps.stats.recording', stats.recording, stats.recording ? 'text-[var(--destructive)]' : 'text-[var(--foreground)]'],
        ['streams:liveOps.stats.incidents', stats.incidents, stats.incidents ? 'text-[var(--warning)]' : 'text-[var(--foreground)]']
      ].map(([labelKey, value, color]) => <div key={labelKey} className="rounded-xl border border-[var(--border-soft)] bg-[var(--card)] px-4 py-3">
        <div className={cn('text-2xl font-semibold tabular-nums', color)}>{value}</div>
        <div className="mt-1 text-[9px] font-semibold tracking-[.12em] text-[var(--text-faint)]">{t(labelKey)}</div>
      </div>)}
    </div>

    {error && <ErrorBanner message={error.message || t('streams:liveOps.loadFailed')} onRetry={() => refreshLiveOperations({ setLoading, setRooms, setExternal, setStreams, setError })} />}
    {external.length > 0 && <div className="mb-4 flex items-center gap-3 rounded-xl border border-[var(--warning)]/20 bg-[var(--warning)]/6 px-4 py-3 text-xs text-[var(--muted-foreground)]">
      <AlertTriangle size={15} className="text-[var(--warning)]" />
      <span>{t('streams:liveOps.externalWarn', { count: external.length })}</span>
      <Link className={btnSecondary} to="/streams-legacy">{t('streams:liveOps.registerExternal')}</Link>
    </div>}

    <div className="mb-4 space-y-2 border-b border-[var(--border-soft)] pb-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-[10px] font-semibold tracking-[.08em] text-[var(--text-faint)]">{t('streams:liveOps.filter.directionTitle')}</span>
        {[['all', 'streams:liveOps.filter.directionAll'], ...DIRECTION_IDS.map(id => [id, getDirection(id).labelKey])].map(([value, labelKey]) => (
          <button key={value} type="button" aria-pressed={directionFilter === value} onClick={() => setDirectionFilter(value)} className={directionFilter === value ? btnSecondary : btnGhost}>{t(labelKey)}</button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-[10px] font-semibold tracking-[.08em] text-[var(--text-faint)]">{t('streams:liveOps.filter.statusTitle')}</span>
        {[['all', BUCKET_FILTER_KEYS.all], ...ROOM_BUCKETS.map(bucket => [bucket, BUCKET_FILTER_KEYS[bucket]])].map(([value, labelKey]) => (
          <button key={value} type="button" aria-pressed={statusFilter === value} onClick={() => setStatusFilter(value)} className={statusFilter === value ? btnSecondary : btnGhost}>{t(labelKey)}</button>
        ))}
        <span className="ml-auto text-xs text-[var(--muted-foreground)]">{hasFilter ? t('streams:liveOps.filter.resultCount', { found: filtered.length, total: rooms.length }) : t('streams:liveOps.filter.resources', { count: rooms.length })}</span>
      </div>
    </div>

    <div className="min-h-0 min-[1440px]:grid min-[1440px]:grid-cols-[minmax(0,1fr)_minmax(360px,400px)] min-[1440px]:items-start min-[1440px]:gap-4">
      <div onKeyDown={onListKeyDown} className="min-w-0 space-y-2.5 outline-none" tabIndex={0} aria-label={t('streams:liveOps.listLabel')}>
        {filtered.length
          ? filtered.map(room => <RoomRow
            key={room.room.id}
            room={room}
            stream={streamsById[String(room.room.legacy_stream_id)]}
            selected={room.room.id === selectedRoomId}
            query={search}
            onSelect={next => setSelectedRoomId(next.room.id)}
            onOpen={openWorkspace}
            t={t}
          />)
          : <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--card)]">
            <EmptyState
              title={hasFilter ? t('streams:liveOps.empty.filtered') : t('streams:liveOps.empty.none')}
              description={hasFilter ? t('streams:liveOps.empty.filteredDesc') : t('streams:liveOps.empty.noneDesc')}
              action={hasFilter
                ? <button className={btnSecondary} onClick={() => { setSearch(''); setStatusFilter('all'); setDirectionFilter('all'); }}>{t('streams:liveOps.empty.clear')}</button>
                : <button className={btnPrimary} onClick={() => setOpen(true)}>{t('streams:liveOps.create')}</button>}
            />
          </div>}
      </div>

      {selectedRoom && <>
        <div className="fixed inset-0 z-30 bg-black/40 min-[1440px]:hidden" onClick={() => setSelectedRoomId(null)} aria-hidden="true" />
        <aside className="fixed inset-y-0 right-0 z-40 w-[min(420px,94vw)] overflow-y-auto border-l border-[var(--border-soft)] bg-[var(--background)] p-4 min-[1440px]:static min-[1440px]:z-auto min-[1440px]:w-auto min-[1440px]:overflow-visible min-[1440px]:border-l-0 min-[1440px]:bg-transparent min-[1440px]:p-0">
          <RoomCommandPanel
            room={selectedRoom}
            onClose={() => setSelectedRoomId(null)}
          />
        </aside>
      </>}
    </div>

    <CreateRoomWizard
      open={open}
      onClose={() => setOpen(false)}
      onCreated={() => refreshLiveOperations({ silent: true, setLoading, setRooms, setExternal, setStreams, setError })}
    />
  </div>;
}
