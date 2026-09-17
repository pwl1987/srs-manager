import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { api } from '../lib/api';
import { cn } from '../lib/utils';
import { copyText } from '../lib/clipboard';
import { formatDateTime, formatDuration } from '../i18n/format';
import { getErrorCode } from '../lib/error-mapper';
import PageHeader from '../components/ui/PageHeader';
import TableShell from '../components/ui/TableShell';
import EmptyState from '../components/ui/EmptyState';
import ErrorBanner from '../components/ui/ErrorBanner';
import { TableSkeleton } from '../components/ui/Skeleton';
import SearchInput from '../components/ui/SearchInput';
import Modal from '../components/ui/Modal';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import { inputClass, labelClass, btnPrimary, btnSecondary, btnGhost, thClass, tdClass } from '../components/ui/styles';
import { Plus, Edit, Trash2, Copy, RefreshCw, Globe } from 'lucide-react';

export default function DnsRecords() {
  const { t } = useTranslation(['dns', 'common']);
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: '', type: 'CNAME', value: '', ttl: 600 });
  const [formError, setFormError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    loadRecords();
  }, []);

  async function loadRecords() {
    setLoading(true);
    setLoadError(null);
    try {
      setRecords(await api.get('/dns/records'));
    } catch (err) {
      setLoadError({ code: getErrorCode(err) });
    } finally {
      setLoading(false);
    }
  }

  async function handleSync() {
    setSyncing(true);
    try {
      await api.post('/dns/records/sync');
      toast.success(t('common:toasts.synced'));
      loadRecords();
    } catch (err) {
      toast.error(t(`common:errors.${getErrorCode(err)}`));
    } finally {
      setSyncing(false);
    }
  }

  function openCreate() {
    setEditing(null);
    setForm({ name: '', type: 'CNAME', value: '', ttl: 600 });
    setFormError('');
    setShowModal(true);
  }

  function openEdit(record) {
    setEditing(record);
    setForm({ name: record.name, type: record.type, value: record.value, ttl: record.ttl });
    setFormError('');
    setShowModal(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setFormError('');
    try {
      if (editing) {
        await api.put(`/dns/records/${editing.id}`, form);
        toast.success(t('common:toasts.updated'));
      } else {
        await api.post('/dns/records', form);
        toast.success(t('common:toasts.created'));
      }
      setShowModal(false);
      loadRecords();
    } catch (err) {
      setFormError(t(`common:errors.${getErrorCode(err)}`));
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setWorking(true);
    try {
      await api.delete(`/dns/records/${deleteTarget.id}`);
      toast.success(t('common:toasts.deleted'));
      setDeleteTarget(null);
      loadRecords();
    } catch (err) {
      toast.error(t(`common:errors.${getErrorCode(err)}`));
    } finally {
      setWorking(false);
    }
  }

  async function handleCopy(value) {
    try {
      await copyText(value);
      toast.success(t('common:toasts.copied'));
    } catch {
      toast.error(t('common:errors.INTERNAL_GENERAL'));
    }
  }

  const filtered = search
    ? records.filter(r => (r.name || '').toLowerCase().includes(search.toLowerCase()) || (r.value || '').includes(search))
    : records;

  return (
    <div>
      <PageHeader
        title={t('dns:title')}
        subtitle={t('dns:subtitle')}
        actions={
          <>
            <SearchInput value={search} onChange={setSearch} placeholder={t('common:labels.searchPlaceholder')} />
            <button className={btnSecondary} onClick={handleSync} disabled={syncing}>
              <RefreshCw size={16} className={syncing ? 'animate-spin' : ''} /> {t('common:actions.refresh')}
            </button>
            <button className={btnPrimary} onClick={openCreate}>
              <Plus size={16} /> {t('common:actions.create')}
            </button>
          </>
        }
      />

      {loadError && <ErrorBanner message={t(`common:errors.${loadError.code}`)} onRetry={loadRecords} />}

      {loading ? (
        <TableSkeleton rows={4} />
      ) : filtered.length === 0 ? (
        <div className="bg-[var(--card)] rounded-lg border">
          <EmptyState title={search ? t('common:page.emptyTitle') : t('dns:empty.title')} />
        </div>
      ) : (
        <TableShell>
          <thead>
            <tr className="border-b">
              <th className={thClass}>{t('dns:columns.name')}</th>
              <th className={thClass}>{t('dns:columns.type')}</th>
              <th className={thClass}>{t('dns:columns.value')}</th>
              <th className={thClass}>{t('dns:columns.ttl')}</th>
              <th className={thClass}>{t('dns:columns.status')}</th>
              <th className={thClass}>{t('dns:columns.createdAt')}</th>
              <th className={`${thClass} text-right`}>{t('dns:columns.actions')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {filtered.map(r => (
              <tr key={r.id} className="hover:bg-[var(--surface-hover)] transition-colors">
                <td className={tdClass}>
                  <span className="flex items-center gap-2 font-medium">
                    <Globe size={14} className="text-[var(--muted-foreground)] shrink-0" />
                    <span className="truncate max-w-[220px]" title={r.name}>{r.name}</span>
                  </span>
                </td>
                <td className={tdClass}>
                  <span className="px-2 py-1 rounded bg-[var(--secondary)] text-xs">{r.type}</span>
                </td>
                <td className={tdClass}>
                  <span className="flex items-center gap-2 min-w-0">
                    <code className="text-xs bg-[var(--muted)] px-2 py-1 rounded truncate max-w-[280px] font-mono" title={r.value}>{r.value}</code>
                    <button className={btnGhost} onClick={() => handleCopy(r.value)} title={t('common:actions.copy')}>
                      <Copy size={12} />
                    </button>
                  </span>
                </td>
                <td className={`${tdClass} whitespace-nowrap text-[var(--muted-foreground)]`} title={`${r.ttl}s`}>
                  {formatDuration(r.ttl)}
                </td>
                <td className={tdClass}>
                  <span className={cn('text-xs', r.status === 'active' ? 'text-[var(--success)]' : 'text-[var(--muted-foreground)]')}>
                    {t(`dns:status.${r.status}`, r.status)}
                  </span>
                </td>
                <td className={`${tdClass} whitespace-nowrap text-[var(--muted-foreground)]`}>{formatDateTime(r.created_at)}</td>
                <td className={tdClass}>
                  <div className="flex items-center justify-end gap-0.5">
                    <button className={btnGhost} onClick={() => openEdit(r)} title={t('common:actions.edit')}><Edit size={14} /></button>
                    <button
                      className={cn(btnGhost, 'text-[var(--destructive)] hover:text-[var(--destructive)] hover:bg-[var(--destructive)]/15')}
                      onClick={() => setDeleteTarget(r)}
                      title={t('common:actions.delete')}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      )}

      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        title={editing ? t('dns:modal.edit') : t('dns:modal.create')}
        footer={
          <>
            <button className={btnSecondary} onClick={() => setShowModal(false)}>{t('common:actions.cancel')}</button>
            <button className={btnPrimary} form="dns-form" type="submit">
              {editing ? t('common:actions.save') : t('common:actions.create')}
            </button>
          </>
        }
      >
        <form id="dns-form" onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className={labelClass}>{t('dns:modal.name')}</label>
            <input
              type="text"
              value={form.name}
              onChange={e => setForm({ ...form, name: e.target.value })}
              placeholder={t('dns:modal.namePlaceholder')}
              className={inputClass}
              required
            />
          </div>
          <div>
            <label className={labelClass}>{t('dns:modal.type')}</label>
            <select
              value={form.type}
              onChange={e => setForm({ ...form, type: e.target.value })}
              className={inputClass}
            >
              <option value="A">A</option>
              <option value="AAAA">AAAA</option>
              <option value="CNAME">CNAME</option>
              <option value="TXT">TXT</option>
              <option value="MX">MX</option>
            </select>
          </div>
          <div>
            <label className={labelClass}>{t('dns:modal.value')}</label>
            <input
              type="text"
              value={form.value}
              onChange={e => setForm({ ...form, value: e.target.value })}
              placeholder={t('dns:modal.valuePlaceholder')}
              className={inputClass}
              required
            />
          </div>
          <div>
            <label className={labelClass}>{t('dns:modal.ttl')}</label>
            <input
              type="number"
              value={form.ttl}
              onChange={e => setForm({ ...form, ttl: parseInt(e.target.value, 10) || 600 })}
              className={inputClass}
              min={60}
              max={86400}
            />
          </div>
          {formError && <p className="text-[var(--destructive)] text-sm">{formError}</p>}
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        confirming={working}
        title={t('common:confirm.delete.title')}
        description={t('common:confirm.delete.description', { detail: deleteTarget?.name || '' })}
        confirmLabel={t('common:confirm.delete.confirm')}
      />
    </div>
  );
}
