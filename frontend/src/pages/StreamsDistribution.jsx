import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { api } from '../lib/api';
import { cn, formatTime, statusColor } from '../lib/utils';
import { getErrorCode } from '../lib/error-mapper';
import Modal from '../components/ui/Modal';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import { inputClass, labelClass, btnPrimary, btnSecondary, btnGhost } from '../components/ui/styles';
import { Plus, Clock, Ban, History, FileText, Trash2 } from 'lucide-react';

// Per-stream distribution management, embedded in the Streams page expanded
// row. Replaces the standalone Distribution page (the sidebar entry is gone).
export default function DistributionSection({ stream }) {
  const { t } = useTranslation(['distribution', 'common']);
  const [requests, setRequests] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ applicant: '', region: '', purpose: '', pull_url: '', expires_at: '', notes: '' });
  const [formError, setFormError] = useState('');
  const [logs, setLogs] = useState(null);
  const [extendTarget, setExtendTarget] = useState(null);
  const [extendValue, setExtendValue] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [revokeTarget, setRevokeTarget] = useState(null);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    load();
  }, [stream.id]);

  async function load() {
    try {
      const all = await api.get('/distribution');
      setRequests(all.filter(r => String(r.stream_id) === String(stream.id)));
    } catch {
      setRequests([]);
    }
  }

  function openCreate() {
    setForm({ applicant: '', region: '', purpose: '', pull_url: '', expires_at: '', notes: '' });
    setFormError('');
    setShowModal(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setFormError('');
    try {
      await api.post('/distribution', { ...form, stream_id: stream.id });
      toast.success(t('common:toasts.created'));
      setShowModal(false);
      load();
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
      load();
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
      load();
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
      load();
    } catch (err) {
      toast.error(t(`common:errors.${getErrorCode(err)}`));
    } finally {
      setWorking(false);
    }
  }

  async function showLogs(id) {
    try {
      setLogs(await api.get(`/distribution/${id}/logs`));
    } catch (err) {
      toast.error(t(`common:errors.${getErrorCode(err)}`));
    }
  }

  return (
    <div className="pt-3 border-t border-[var(--border)] mt-3">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-xs font-bold uppercase tracking-wide text-[var(--muted-foreground)] flex items-center gap-1.5">
          <FileText size={12} />
          {t('streams:distributionSection.title')} ({requests ? requests.length : '…'})
        </h4>
        <button className={cn(btnSecondary, 'text-xs py-1')} onClick={openCreate}>
          <Plus size={12} /> {t('streams:distributionSection.create')}
        </button>
      </div>

      {requests === null ? (
        <p className="text-xs text-[var(--muted-foreground)]">…</p>
      ) : requests.length === 0 ? (
        <p className="text-xs text-[var(--muted-foreground)] py-1">{t('distribution:empty')}</p>
      ) : (
        <div className="space-y-1">
          {requests.map(r => (
            <div key={r.id} className="flex items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2 min-w-0">
                <span className={`font-medium whitespace-nowrap ${statusColor(r.status)}`}>{t(`distribution:status.${r.status}`, r.status)}</span>
                <span className="font-medium truncate">{r.applicant}</span>
                <span className="text-[var(--muted-foreground)] whitespace-nowrap">
                  {r.region || '-'} · {r.expires_at ? formatTime(r.expires_at) : '-'}
                </span>
              </div>
              <div className="flex items-center gap-0.5 shrink-0">
                {(r.status === 'active' || r.status === 'extended') && (
                  <>
                    <button className={btnGhost} onClick={() => openExtend(r)} title={t('distribution:actions.extend')}><Clock size={12} /></button>
                    <button
                      className={cn(btnGhost, 'text-[var(--warning)] hover:text-[var(--warning)]')}
                      onClick={() => setRevokeTarget(r)}
                      title={t('distribution:actions.revoke')}
                    >
                      <Ban size={12} />
                    </button>
                  </>
                )}
                <button className={btnGhost} onClick={() => showLogs(r.id)} title={t('distribution:actions.logs')}><History size={12} /></button>
                <button
                  className={cn(btnGhost, 'text-[var(--destructive)] hover:text-[var(--destructive)]')}
                  onClick={() => setDeleteTarget(r)}
                  title={t('distribution:actions.delete')}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        title={t('distribution:modal.create')}
        size="lg"
        footer={
          <>
            <button className={btnSecondary} onClick={() => setShowModal(false)}>{t('common:actions.cancel')}</button>
            <button className={btnPrimary} form="distribution-form" type="submit">{t('common:actions.create')}</button>
          </>
        }
      >
        <form id="distribution-form" onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className={labelClass}>{t('distribution:modal.stream')}</label>
            <input type="text" value={stream.name} disabled className={`${inputClass} font-mono`} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>{t('distribution:modal.applicant')}</label>
              <input type="text" value={form.applicant} onChange={e => setForm({ ...form, applicant: e.target.value })} className={inputClass} required />
            </div>
            <div>
              <label className={labelClass}>{t('distribution:modal.region')}</label>
              <input type="text" value={form.region} onChange={e => setForm({ ...form, region: e.target.value })} className={inputClass} />
            </div>
          </div>
          <div>
            <label className={labelClass}>{t('distribution:modal.purpose')}</label>
            <input type="text" value={form.purpose} onChange={e => setForm({ ...form, purpose: e.target.value })} className={inputClass} />
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
        open={Boolean(logs)}
        onClose={() => setLogs(null)}
        title={t('distribution:logs.title')}
        size="sm"
      >
        <div className="space-y-3 max-h-80 overflow-y-auto">
          {logs?.length ? logs.map(log => (
            <div key={log.id} className="text-sm">
              <span className="text-[var(--muted-foreground)] text-xs">{formatTime(log.created_at)}</span>
              <span className="ml-2 font-medium">{t(`distribution:logs.actions.${log.action}`, log.action)}</span>
              {log.detail && <p className="text-xs text-[var(--muted-foreground)] mt-0.5 break-all">{log.detail}</p>}
            </div>
          )) : <p className="text-sm text-[var(--muted-foreground)]">{t('distribution:logs.empty')}</p>}
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
