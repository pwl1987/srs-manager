import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { api } from '../lib/api';
import { cn } from '../lib/utils';
import { copyText } from '../lib/clipboard';
import { formatDateTime, formatBitrateKbps } from '../i18n/format';
import { getErrorCode } from '../lib/error-mapper';
import { usePolling } from '../lib/use-polling';
import PageHeader from '../components/ui/PageHeader';
import TableShell from '../components/ui/TableShell';
import EmptyState from '../components/ui/EmptyState';
import ErrorBanner from '../components/ui/ErrorBanner';
import { TableSkeleton } from '../components/ui/Skeleton';
import SearchInput from '../components/ui/SearchInput';
import Modal from '../components/ui/Modal';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import { inputClass, labelClass, btnPrimary, btnSecondary, btnGhost, thClass, tdClass, helpTextClass } from '../components/ui/styles';
import { Satellite, Plus, Edit, Trash2, Copy, CheckCircle, Loader2, XCircle, AlertTriangle } from 'lucide-react';

export default function CdnChannels() {
  const { t } = useTranslation(['channels', 'common']);
  const [channels, setChannels] = useState([]);
  const [streams, setStreams] = useState([]);
  const [liveStates, setLiveStates] = useState({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ channel_name: '', stream_id: '', push_domain: '', pull_domain: '', region: '', auto_dns: false });
  const [formError, setFormError] = useState('');
  const [creating, setCreating] = useState(false);
  const [createResult, setCreateResult] = useState(null);
  const [dnsDomain, setDnsDomain] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [working, setWorking] = useState(false);
  // null = unknown, false = no verified Wangsu credentials (creation is unavailable)
  const [wangsuConfigured, setWangsuConfigured] = useState(null);

  useEffect(() => {
    api.get('/streams').then(setStreams).catch(() => {});
    api.get('/settings').then(s => setDnsDomain(s.dns_domain || '')).catch(() => {});
    api.get('/cdn/auth-config')
      .then(d => setWangsuConfigured(Boolean(d?.auth)))
      .catch(() => setWangsuConfigured(true));
  }, []);

  async function loadChannels(silent = false) {
    if (!silent) setLoading(true);
    if (!silent) setLoadError(null);
    try {
      setChannels(await api.get('/cdn/channels'));
    } catch (err) {
      setLoadError({ code: getErrorCode(err) });
    } finally {
      setLoading(false);
    }
  }

  async function loadLiveStates() {
    try {
      const res = await api.get('/cdn/channels/batch-state');
      const map = {};
      for (const s of res.states || []) map[s.channel_id] = s;
      setLiveStates(map);
    } catch {
      // live state is best-effort; the static table stays usable
    }
  }

  usePolling(() => loadChannels(true), 30000);
  usePolling(loadLiveStates, 30000);

  const filtered = search
    ? channels.filter(c => (c.channel_name || '').toLowerCase().includes(search.toLowerCase()) || (c.push_domain || '').includes(search))
    : channels;

  function openCreate() {
    setEditing(null);
    setForm({ channel_name: '', stream_id: streams[0]?.id || '', push_domain: '', pull_domain: '', region: '', auto_dns: false });
    setFormError('');
    setCreating(false);
    setCreateResult(null);
    setShowModal(true);
  }

  function openEdit(channel) {
    setEditing(channel);
    setForm({ channel_name: channel.channel_name, stream_id: channel.stream_id || '', region: channel.region || '', push_domain: channel.push_domain || '' });
    setFormError('');
    setShowModal(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setFormError('');
    if (editing) {
      try {
        await api.put(`/cdn/channels/${editing.id}`, {
          channel_name: form.channel_name,
          stream_id: form.stream_id || null,
          region: form.region
        });
        setShowModal(false);
        toast.success(t('common:toasts.updated'));
        loadChannels(true);
      } catch (err) {
        setFormError(t(`common:errors.${getErrorCode(err)}`));
      }
      return;
    }
    setCreating(true);
    setCreateResult(null);
    try {
      const res = await api.post('/cdn/channels', form);
      setCreateResult(res);
    } catch (err) {
      setFormError(t(`common:errors.${getErrorCode(err)}`));
      setCreating(false);
    }
  }

  function closeCreateModal() {
    setShowModal(false);
    setCreating(false);
    setCreateResult(null);
    if (createResult) {
      toast.success(t('channels:progress.success'));
      loadChannels(true);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setWorking(true);
    try {
      await api.delete(`/cdn/channels/${deleteTarget.id}`);
      toast.success(t('common:toasts.deleted'));
      setDeleteTarget(null);
      loadChannels(true);
    } catch (err) {
      toast.error(t(`common:errors.${getErrorCode(err)}`));
    } finally {
      setWorking(false);
    }
  }

  async function handleCopy(url) {
    if (!url) return;
    try {
      await copyText(url);
      toast.success(t('common:toasts.copied'));
    } catch {
      toast.error(t('common:errors.INTERNAL_GENERAL'));
    }
  }

  return (
    <div>
      <PageHeader
        title={t('channels:title')}
        subtitle={t('channels:subtitle')}
        actions={
          <>
            <SearchInput value={search} onChange={setSearch} placeholder={t('common:labels.searchPlaceholder')} />
            <button
              className={cn(btnPrimary, 'disabled:opacity-50 disabled:cursor-not-allowed')}
              onClick={openCreate}
              disabled={wangsuConfigured === false}
              title={wangsuConfigured === false ? t('channels:credentials.missing') : undefined}
            >
              <Plus size={16} /> {t('common:actions.create')}
            </button>
          </>
        }
      />

      {wangsuConfigured === false && (
        <div className="mb-4 flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-500">
          <AlertTriangle size={18} className="mt-0.5 shrink-0" />
          <div className="min-w-0">
            {t('channels:credentials.missing')}{' '}
            <Link to="/wangsu-auth" className="font-medium underline underline-offset-2 whitespace-nowrap">
              {t('channels:credentials.configure')}
            </Link>
          </div>
        </div>
      )}

      {loadError && <ErrorBanner message={t(`common:errors.${loadError.code}`)} onRetry={() => loadChannels()} />}

      {loading ? (
        <TableSkeleton rows={3} />
      ) : filtered.length === 0 ? (
        <div className="bg-[var(--card)] rounded-lg border">
          <EmptyState title={search ? t('common:page.emptyTitle') : t('common:page.emptyTitle')} description={search ? undefined : t('common:page.emptyDescription')} />
        </div>
      ) : (
        <TableShell>
          <thead>
            <tr className="border-b">
              <th className={thClass}>{t('channels:columns.name')}</th>
              <th className={thClass}>{t('channels:columns.stream')}</th>
              <th className={thClass}>{t('channels:columns.pushDomain')}</th>
              <th className={thClass}>{t('channels:columns.status')}</th>
              <th className={thClass}>{t('channels:columns.viewers')}</th>
              <th className={thClass}>{t('channels:columns.bitrate')}</th>
              <th className={thClass}>{t('channels:columns.createdAt')}</th>
              <th className={`${thClass} text-right`}>{t('channels:columns.actions')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {filtered.map(c => {
              const stream = streams.find(s => s.id === c.stream_id);
              const live = liveStates[c.channel_id];
              const isLive = Boolean(live?.is_live);
              return (
                <tr key={c.id} className="hover:bg-[var(--surface-hover)] transition-colors">
                  <td className={`${tdClass} font-medium`}>{c.channel_name}</td>
                  <td className={tdClass}>{stream?.name || '-'}</td>
                  <td className={`${tdClass} text-[var(--muted-foreground)] font-mono text-xs max-w-[200px] truncate`} title={c.push_domain}>{c.push_domain}</td>
                  <td className={tdClass}>
                    <span className={cn('text-xs px-2 py-1 rounded whitespace-nowrap',
                      isLive ? 'bg-[var(--success)]/10 text-[var(--success)]' : 'bg-[var(--secondary)] text-[var(--muted-foreground)]')}>
                      {isLive ? t('channels:status.live') : t('channels:status.idle')}
                    </span>
                  </td>
                  <td className={tdClass}>{live ? live.viewers : '-'}</td>
                  <td className={tdClass}>{live?.is_live ? formatBitrateKbps(live.bitrate) : '-'}</td>
                  <td className={`${tdClass} whitespace-nowrap text-[var(--muted-foreground)]`}>{formatDateTime(c.created_at)}</td>
                  <td className={tdClass}>
                    <div className="flex items-center justify-end gap-0.5">
                      {c.pull_url_hls && (
                        <button className={btnGhost} onClick={() => handleCopy(c.pull_url_hls)} title={t('channels:actions.copyPullUrl')}><Copy size={14} /></button>
                      )}
                      <button className={btnGhost} onClick={() => openEdit(c)} title={t('channels:actions.edit')}><Edit size={14} /></button>
                      <button
                        className={cn(btnGhost, 'text-[var(--destructive)] hover:text-[var(--destructive)] hover:bg-[var(--destructive)]/15')}
                        onClick={() => setDeleteTarget(c)}
                        title={t('channels:actions.delete')}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </TableShell>
      )}

      <Modal
        open={showModal}
        onClose={creating ? () => {} : closeCreateModal}
        title={editing ? t('channels:modal.edit') : t('channels:modal.create')}
      >
        {creating ? (
          <div className="py-6 space-y-4">
            <div className="flex items-center gap-3 text-[var(--muted-foreground)]">
              {createResult ? <CheckCircle size={20} className="text-[var(--success)]" /> : <Loader2 size={20} className="animate-spin" />}
              <span className="text-sm">{t('channels:progress.step1')}</span>
            </div>
            {createResult && !form.auto_dns && (
              <div className="flex items-center gap-3 text-[var(--muted-foreground)]">
                <XCircle size={20} className="text-[var(--muted-foreground)]" />
                <span className="text-sm">{t('channels:progress.dnsSkipped')}</span>
              </div>
            )}
            {createResult && form.auto_dns && createResult.dnsRecord && !createResult.dnsRecord.error && (
              <div className="flex items-center gap-3 text-[var(--success)]">
                <CheckCircle size={20} />
                <span className="text-sm">{t('channels:progress.dnsSuccess')}</span>
              </div>
            )}
            {createResult && form.auto_dns && createResult.dnsRecord?.error && (
              <div className="flex items-center gap-3 text-[var(--destructive)]">
                <XCircle size={20} />
                <span className="text-sm">{t('channels:progress.dnsFailed')}：{createResult.dnsRecord.error}</span>
              </div>
            )}
            {createResult && (
              <button className={`${btnPrimary} w-full mt-2`} onClick={closeCreateModal}>{t('common:actions.close')}</button>
            )}
          </div>
        ) : (
          <form id="channel-form" onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className={labelClass}>{t('channels:modal.name')}</label>
              <input
                type="text"
                value={form.channel_name}
                onChange={e => setForm({ ...form, channel_name: e.target.value })}
                placeholder={t('channels:modal.namePlaceholder')}
                className={inputClass}
                required
              />
            </div>
            <div>
              <label className={labelClass}>{t('channels:modal.stream')}</label>
              <select
                value={form.stream_id}
                onChange={e => setForm({ ...form, stream_id: e.target.value })}
                className={inputClass}
              >
                <option value="">{t('common:labels.selectPlaceholder')}</option>
                {streams.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            {editing ? (
              <div>
                <label className={labelClass}>{t('channels:modal.pushDomainCurrent')}</label>
                <p className="text-sm font-mono bg-[var(--muted)] px-3 py-2 rounded break-all">{editing.push_domain}</p>
                <p className={helpTextClass}>{t('channels:modal.domainsReadOnly')}</p>
              </div>
            ) : (
              <>
                <div>
                  <label className={labelClass}>{t('channels:modal.pushDomain')}</label>
                  <input
                    type="text"
                    value={form.push_domain}
                    onChange={e => setForm({ ...form, push_domain: e.target.value })}
                    placeholder={t('channels:modal.pushDomainPlaceholder')}
                    className={inputClass}
                    required
                  />
                </div>
                <div>
                  <label className={labelClass}>{t('channels:modal.pullDomain')}</label>
                  <input
                    type="text"
                    value={form.pull_domain}
                    onChange={e => setForm({ ...form, pull_domain: e.target.value })}
                    placeholder={t('channels:modal.pullDomainPlaceholder')}
                    className={inputClass}
                  />
                </div>
              </>
            )}
            <div>
              <label className={labelClass}>{t('channels:modal.region')}</label>
              <input
                type="text"
                value={form.region}
                onChange={e => setForm({ ...form, region: e.target.value })}
                className={inputClass}
              />
            </div>

            {!editing && (
              <div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.auto_dns}
                    onChange={e => setForm({ ...form, auto_dns: e.target.checked })}
                    className="w-4 h-4 rounded"
                  />
                  <span className="text-sm font-medium">{t('channels:modal.autoDns')}</span>
                </label>
                <p className={cn(helpTextClass, 'ml-6')}>{t('channels:modal.autoDnsDescription')}</p>
                {form.auto_dns && form.push_domain && (
                  <div className="mt-2 ml-6 p-3 bg-[var(--muted)] rounded text-xs">
                    <div className="font-semibold mb-1">{t('channels:modal.previewTitle')}</div>
                    <div className="flex gap-2 flex-wrap">
                      <span className="px-1.5 py-0.5 bg-[var(--secondary)] rounded">{t('channels:modal.previewCname')}</span>
                      <span className="font-mono break-all">
                        {form.channel_name || 'channel'}.{dnsDomain || 'example.com'} → {t('channels:modal.previewTarget', { domain: form.push_domain })}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {formError && <p className="text-[var(--destructive)] text-sm">{formError}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" className={btnSecondary} onClick={closeCreateModal}>{t('common:actions.cancel')}</button>
              <button type="submit" className={btnPrimary}>
                {editing ? t('common:actions.save') : t('common:actions.create')}
              </button>
            </div>
          </form>
        )}
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        confirming={working}
        title={t('common:confirm.delete.title')}
        description={t('common:confirm.delete.description', { detail: deleteTarget?.channel_name || '' })}
        confirmLabel={t('common:confirm.delete.confirm')}
      />
    </div>
  );
}
