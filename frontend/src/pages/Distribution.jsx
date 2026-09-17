import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { api } from '../lib/api';
import { cn, formatTime, statusColor } from '../lib/utils';
import { copyText } from '../lib/clipboard';
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
import { Plus, Edit, Trash2, Clock, Ban, History, Copy } from 'lucide-react';

export default function Distribution() {
  const { t } = useTranslation(['distribution', 'common']);
  const [requests, setRequests] = useState([]);
  const [streams, setStreams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({
    stream_id: '', applicant: '', region: '', purpose: '',
    pull_url: '', expires_at: '', notes: ''
  });
  const [formError, setFormError] = useState('');
  const [logsRequest, setLogsRequest] = useState(null);
  const [logs, setLogs] = useState([]);
  const [extendTarget, setExtendTarget] = useState(null);
  const [extendValue, setExtendValue] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [revokeTarget, setRevokeTarget] = useState(null);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    loadRequests();
    api.get('/streams').then(setStreams).catch(() => {});
  }, []);

  async function loadRequests() {
    setLoading(true);
    setLoadError(null);
    try {
      setRequests(await api.get('/distribution'));
    } catch (err) {
      setLoadError({ code: getErrorCode(err) });
    } finally {
      setLoading(false);
    }
  }

  function openCreate() {
    setEditing(null);
    setForm({
      stream_id: streams[0]?.id || '', applicant: '', region: '', purpose: '',
      pull_url: '', expires_at: '', notes: ''
    });
    setFormError('');
    setShowModal(true);
  }

  function openEdit(req) {
    setEditing(req);
    setForm({
      stream_id: req.stream_id, applicant: req.applicant, region: req.region || '',
      purpose: req.purpose || '', pull_url: req.pull_url || '',
      expires_at: (req.expires_at || '').slice(0, 16), notes: req.notes || ''
    });
    setFormError('');
    setShowModal(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setFormError('');
    try {
      if (editing) {
        await api.put(`/distribution/${editing.id}`, form);
        toast.success(t('common:toasts.updated'));
      } else {
        await api.post('/distribution', form);
        toast.success(t('common:toasts.created'));
      }
      setShowModal(false);
      loadRequests();
    } catch (err) {
      setFormError(t(`common:errors.${getErrorCode(err)}`));
    }
  }

  function openExtend(req) {
    const current = req.expires_at ? new Date(req.expires_at) : new Date();
    current.setMinutes(current.getMinutes() - current.getTimezoneOffset());
    setExtendValue(current.toISOString().slice(0, 16));
    setExtendTarget(req);
  }

  async function confirmExtend() {
    if (!extendTarget || !extendValue) return;
    setWorking(true);
    try {
      await api.put(`/distribution/${extendTarget.id}/extend`, { new_expiry: new Date(extendValue).toISOString() });
      toast.success(t('common:toasts.updated'));
      setExtendTarget(null);
      loadRequests();
    } catch (err) {
      toast.error(t(`common:errors.${getErrorCode(err)}`));
    } finally {
      setWorking(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setWorking(true);
    try {
      await api.delete(`/distribution/${deleteTarget.id}`);
      toast.success(t('common:toasts.deleted'));
      setDeleteTarget(null);
      loadRequests();
    } catch (err) {
      toast.error(t(`common:errors.${getErrorCode(err)}`));
    } finally {
      setWorking(false);
    }
  }

  async function confirmRevoke() {
    if (!revokeTarget) return;
    setWorking(true);
    try {
      await api.put(`/distribution/${revokeTarget.id}/revoke`);
      toast.success(t('common:toasts.updated'));
      setRevokeTarget(null);
      loadRequests();
    } catch (err) {
      toast.error(t(`common:errors.${getErrorCode(err)}`));
    } finally {
      setWorking(false);
    }
  }

  async function showLogs(id) {
    try {
      setLogsRequest(id);
      setLogs(await api.get(`/distribution/${id}/logs`));
    } catch (err) {
      toast.error(t(`common:errors.${getErrorCode(err)}`));
    }
  }

  async function copyPullUrl(url) {
    try {
      await copyText(url);
      toast.success(t('common:toasts.copied'));
    } catch {
      toast.error(t('common:errors.INTERNAL_GENERAL'));
    }
  }

  const filtered = search
    ? requests.filter(r =>
        (r.applicant || '').toLowerCase().includes(search.toLowerCase()) ||
        (r.purpose || '').toLowerCase().includes(search.toLowerCase()))
    : requests;

  return (
    <div>
      <PageHeader
        title={t('distribution:title')}
        subtitle={t('distribution:subtitle')}
        actions={
          <>
            <SearchInput value={search} onChange={setSearch} placeholder={t('common:labels.searchPlaceholder')} />
            <button className={btnPrimary} onClick={openCreate}>
              <Plus size={16} /> {t('distribution:actions.create')}
            </button>
          </>
        }
      />

      {loadError && <ErrorBanner message={t(`common:errors.${loadError.code}`)} onRetry={loadRequests} />}

      {loading ? (
        <TableSkeleton rows={4} />
      ) : filtered.length === 0 ? (
        <div className="bg-[var(--card)] rounded-lg border">
          <EmptyState title={search ? t('common:page.emptyTitle') : t('distribution:empty')} />
        </div>
      ) : (
        <TableShell>
          <thead>
            <tr className="border-b">
              <th className={thClass}>{t('distribution:columns.stream')}</th>
              <th className={thClass}>{t('distribution:columns.applicant')}</th>
              <th className={thClass}>{t('distribution:columns.region')}</th>
              <th className={thClass}>{t('distribution:columns.pullUrl')}</th>
              <th className={thClass}>{t('distribution:columns.expiresAt')}</th>
              <th className={thClass}>{t('distribution:columns.status')}</th>
              <th className={`${thClass} text-right`}>{t('distribution:columns.actions')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {filtered.map(r => {
              const stream = streams.find(s => s.id === r.stream_id);
              return (
                <tr key={r.id} className="hover:bg-[var(--surface-hover)] transition-colors">
                  <td className={tdClass}>{stream?.name || '-'}</td>
                  <td className={`${tdClass} font-medium`}>{r.applicant}</td>
                  <td className={tdClass}>{r.region || '-'}</td>
                  <td className={tdClass}>
                    <span className="flex items-center gap-1.5 min-w-0">
                      <span className="font-mono text-xs truncate max-w-[200px]" title={r.pull_url}>{r.pull_url || '-'}</span>
                      {r.pull_url && (
                        <button className={cn(btnGhost, 'shrink-0')} onClick={() => copyPullUrl(r.pull_url)} title={t('common:actions.copy')}>
                          <Copy size={12} />
                        </button>
                      )}
                    </span>
                  </td>
                  <td className={`${tdClass} whitespace-nowrap`}>{r.expires_at ? formatTime(r.expires_at) : '-'}</td>
                  <td className={`${tdClass} ${statusColor(r.status)} whitespace-nowrap`}>
                    {t(`distribution:status.${r.status}`, r.status)}
                  </td>
                  <td className={tdClass}>
                    <div className="flex items-center justify-end gap-0.5">
                      <button className={btnGhost} onClick={() => openEdit(r)} title={t('common:actions.edit')}><Edit size={14} /></button>
                      {(r.status === 'active' || r.status === 'extended') && (
                        <>
                          <button className={btnGhost} onClick={() => openExtend(r)} title={t('distribution:actions.extend')}><Clock size={14} /></button>
                          <button
                            className={cn(btnGhost, 'text-[var(--warning)] hover:text-[var(--warning)]')}
                            onClick={() => setRevokeTarget(r)}
                            title={t('distribution:actions.revoke')}
                          >
                            <Ban size={14} />
                          </button>
                        </>
                      )}
                      <button className={btnGhost} onClick={() => showLogs(r.id)} title={t('distribution:actions.logs')}><History size={14} /></button>
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
              );
            })}
          </tbody>
        </TableShell>
      )}

      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        title={editing ? t('distribution:modal.edit') : t('distribution:modal.create')}
        size="lg"
        footer={
          <>
            <button className={btnSecondary} onClick={() => setShowModal(false)}>{t('common:actions.cancel')}</button>
            <button className={btnPrimary} form="distribution-form" type="submit">
              {editing ? t('common:actions.save') : t('common:actions.create')}
            </button>
          </>
        }
      >
        <form id="distribution-form" onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>{t('distribution:modal.stream')}</label>
              <select value={form.stream_id} onChange={e => setForm({ ...form, stream_id: e.target.value })} className={inputClass} required>
                <option value="">{t('common:labels.selectPlaceholder')}</option>
                {streams.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className={labelClass}>{t('distribution:modal.applicant')}</label>
              <input type="text" value={form.applicant} onChange={e => setForm({ ...form, applicant: e.target.value })} className={inputClass} required />
            </div>
            <div>
              <label className={labelClass}>{t('distribution:modal.region')}</label>
              <input type="text" value={form.region} onChange={e => setForm({ ...form, region: e.target.value })} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>{t('distribution:modal.purpose')}</label>
              <input type="text" value={form.purpose} onChange={e => setForm({ ...form, purpose: e.target.value })} className={inputClass} />
            </div>
          </div>
          <div>
            <label className={labelClass}>{t('distribution:modal.pullUrl')}</label>
            <input type="text" value={form.pull_url} onChange={e => setForm({ ...form, pull_url: e.target.value })} className={`${inputClass} font-mono`} required />
          </div>
          <div>
            <label className={labelClass}>{t('distribution:modal.expiresAt')}</label>
            <input type="datetime-local" value={form.expires_at} onChange={e => setForm({ ...form, expires_at: e.target.value })} className={inputClass} required />
          </div>
          <div>
            <label className={labelClass}>{t('distribution:modal.notes')}</label>
            <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} className={inputClass} rows={2} />
          </div>
          {formError && <p className="text-[var(--destructive)] text-sm">{formError}</p>}
        </form>
      </Modal>

      <Modal
        open={Boolean(logsRequest)}
        onClose={() => setLogsRequest(null)}
        title={t('distribution:logs.title')}
        size="sm"
      >
        <div className="space-y-3 max-h-80 overflow-y-auto">
          {logs.map(log => (
            <div key={log.id} className="text-sm">
              <span className="text-[var(--muted-foreground)] text-xs">{formatTime(log.created_at)}</span>
              <span className="ml-2 font-medium">{t(`distribution:logs.actions.${log.action}`, log.action)}</span>
              {log.detail && <p className="text-xs text-[var(--muted-foreground)] mt-0.5 break-all">{log.detail}</p>}
            </div>
          ))}
          {logs.length === 0 && <p className="text-sm text-[var(--muted-foreground)]">{t('distribution:logs.empty')}</p>}
        </div>
      </Modal>

      <Modal
        open={Boolean(extendTarget)}
        onClose={() => setExtendTarget(null)}
        title={t('distribution:confirm.extendTitle')}
        size="sm"
        footer={
          <>
            <button className={btnSecondary} onClick={() => setExtendTarget(null)}>{t('common:actions.cancel')}</button>
            <button className={btnPrimary} onClick={confirmExtend} disabled={!extendValue || working}>
              {t('distribution:confirm.extendConfirm')}
            </button>
          </>
        }
      >
        <label className={labelClass}>{t('distribution:modal.expiresAt')}</label>
        <input type="datetime-local" value={extendValue} onChange={e => setExtendValue(e.target.value)} className={inputClass} />
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        confirming={working}
        title={t('common:confirm.delete.title')}
        description={t('common:confirm.delete.description', { detail: deleteTarget?.applicant || '' })}
        confirmLabel={t('common:confirm.delete.confirm')}
      />
      <ConfirmDialog
        open={Boolean(revokeTarget)}
        onClose={() => setRevokeTarget(null)}
        onConfirm={confirmRevoke}
        confirming={working}
        title={t('distribution:confirm.revokeTitle')}
        description={t('common:confirm.delete.description', { detail: revokeTarget?.applicant || '' })}
        confirmLabel={t('distribution:confirm.revokeConfirm')}
      />
    </div>
  );
}
