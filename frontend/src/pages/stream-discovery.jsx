import React from 'react';
import { Plus } from 'lucide-react';
import EmptyState from '../components/ui/EmptyState';
import SearchInput from '../components/ui/SearchInput';
import { btnPrimary, btnSecondary, btnGhost } from '../components/ui/styles';

export function filterStreams(streams, query, statusFilter = 'all') {
  const q = String(query || '').trim().toLowerCase();
  return streams.filter(stream => {
    const statusText = stream.status === 'online' ? '直播中 在线 online' : '空闲 离线 offline';
    const haystack = [stream.name, stream.protocol, stream.status, statusText].filter(Boolean).join(' ').toLowerCase();
    return (!q || haystack.includes(q)) && (statusFilter === 'all' || stream.status === statusFilter);
  });
}

export function StreamHeaderActions({ search, onSearch, onCreate, createLabel }) {
  return <>
    <SearchInput value={search} onChange={onSearch} placeholder="搜索名称、协议或状态" />
    <button className={btnPrimary} onClick={onCreate}><Plus size={16} />{createLabel}</button>
  </>;
}

export function StreamDiscoveryFilters({ statusFilter, onStatusFilter, resultCount, totalCount, hasFilter }) {
  return <div className="mb-5 flex flex-wrap items-center gap-2 border-b border-[var(--border-soft)] pb-4">
    <span className="mr-1 text-[10px] font-semibold tracking-[.08em] text-[var(--text-faint)]">快速筛选</span>
    {[['all', '全部'], ['online', '正在直播'], ['offline', '空闲']].map(([value, label]) => (
      <button key={value} type="button" aria-pressed={statusFilter === value} onClick={() => onStatusFilter(value)} className={statusFilter === value ? btnSecondary : btnGhost}>{label}</button>
    ))}
    <span className="ml-auto text-xs text-[var(--muted-foreground)]">{hasFilter ? `找到 ${resultCount} / ${totalCount} 路` : `${totalCount} 路直播流`}</span>
  </div>;
}
export function StreamFilteredEmptyState({ hasFilter, onClear, onCreate, t }) {
  return <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--card)]">
    <EmptyState
      title={hasFilter ? '没有找到匹配的直播流' : t('streams:empty.title')}
      description={hasFilter ? '可以换一个名称、协议或状态，或清除筛选条件。' : t('streams:empty.description')}
      action={hasFilter ? <button className={btnSecondary} onClick={onClear}>清除筛选</button> : <button className={btnPrimary} onClick={onCreate}>{t('streams:empty.createButton')}</button>}
    />
  </div>;
}
