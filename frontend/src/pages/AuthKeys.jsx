import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { api } from '../lib/api';
import { cn, formatTime } from '../lib/utils';
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
import { Key, Plus, Edit, Trash2, RefreshCw, Copy, Eye, EyeOff, AlertTriangle } from 'lucide-react';

export default function AuthKeys() {
  const { t } = useTranslation(['auth', 'common']);
  const [keys, setKeys] = useState([]);
  const [streams, setStreams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ type: 'push', stream_id: '', description: '', expires_at: '', auto_rotate_days: 30 });
  const [formError, setFormError] = useState('');
  const [revealed, setRevealed] = useState({});
  const [rotateTarget, setRotateTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [working, setWorking] = useState(false);
  const [newKey, setNewKey] = useState(null);

  useEffect(() => {
    loadKeys();
    api.get('/streams').then(setStreams).catch(() => {});
  }, []);

  async function loadKeys() {
    setLoading(true);
    setLoadError(null);
    try {
      setKeys(await api.get('/keys'));
    } catch (err) {
      setLoadError({ code: getErrorCode(err) });
    } finally {
      setLoading(false);
    }
  }

  function openCreate() {
    setEditing(null);
    setForm({ type: 'push', stream_id: streams[0]?.id || '', description: '', expires_at: '', auto_rotate_days: 30 });
    setFormError('');
    setShowModal(true);
  }

  function openEdit(key) {
    setEditing(key);
    setForm({
      type: key.type,
      stream_id: key.stream_id || '',
      description: key.description || '',
      expires_at: (key.expires_at || '').slice(0, 16),
      auto_rotate_days: key.auto_rotate_days || 0
    });
    setFormError('');
    setShowModal(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setFormError('');
    const payload = { ...form, auto_rotate_days: parseInt(form.auto_rotate_days, 10) || 0 };
    try {
      if (editing) {
        await api.put(`/keys/${editing.id}`, payload);
        toast.success(t('common:toasts.updated'));
      } else {
        const created = await api.post('/keys', payload);
        setShowModal(false);
        // Full key is returned exactly once at creation.
        setNewKey(created?.key || null);
      }
      if (editing) setShowModal(false);
      loadKeys();
    } catch (err) {
      setFormError(t(`common:errors.${getErrorCode(err)}`));
    }
  }

  async function confirmRotate() {
    if (!rotateTarget) return;
    setWorking(true);
    try {
      const rotated = await api.post(`/keys/${rotateTarget.id}/rotate`);
      toast.success(t('common:toasts.updated'));
      setRotateTarget(null);
      setNewKey(rotated?.key || null);
      loadKeys();
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
      await api.delete(`/keys/${deleteTarget.id}`);
      toast.success(t('common:toasts.deleted'));
      setDeleteTarget(null);
      loadKeys();
    } catch (err) {
      toast.error(t(`common:errors.${getErrorCode(err)}`));
    } finally {
      setWorking(false);
    }
  }

  async function toggleReveal(key) {
    if (revealed[key.id]) {
      setRevealed(prev => ({ ...prev, [key.id]: undefined }));
      return;
    }
    try {
      const res = await api.get(`/keys/${key.id}/reveal`);
      setRevealed(prev => ({ ...prev, [key.id]: res.key }));
    } catch (err) {
      toast.error(t(`common:errors.${getErrorCode(err)}`));
    }
  }

  async function copyKey(value) {
    try {
      await copyText(value);
      toast.success(t('common:toasts.copied'));
    } catch {
      toast.error(t('common:errors.INTERNAL_GENERAL'));
    }
  }

  async function copyFullKey(key) {
    try {
      const res = await api.get(`/keys/${key.id}/reveal`);
      copyKey(res.key);
    } catch (err) {
      toast.error(t(`common:errors.${getErrorCode(err)}`));
    }
  }

  const q = search.toLowerCase();
  const filtered = search
    ? keys.filter(k => {
        const stream = streams.find(s => s.id === k.stream_id);
        return (k.description || '').toLowerCase().includes(q) ||
          (stream?.name || '').toLowerCase().includes(q) ||
          k.type.toLowerCase().includes(q);
      })
    : keys;

  return (
    <div>
      <PageHeader
        title={t('auth:authKeys.title')}
        subtitle={t('auth:authKeys.subtitle')}
        actions={
          <>
            <SearchInput value={search} onChange={setSearch} placeholder={t('common:labels.searchPlaceholder')} />
            <button className={btnPrimary} onClick={openCreate}>
              <Plus size={16} /> {t('auth:authKeys.actions.create')}
            </button>
          </>
        }
      />

      {loadError && <ErrorBanner message={t(`common:errors.${loadError.code}`)} onRetry={loadKeys} />}

      {loading ? (
        <TableSkeleton rows={3} />
      ) : filtered.length === 0 ? (
        <div className="bg-[var(--card)] rounded-lg border">
          <EmptyState title={search ? t('common:page.emptyTitle') : t('auth:authKeys.empty')} />
        </div>
      ) : (
        <TableShell>
          <thead>
            <tr className="border-b">
              <th className={thClass}>{t('auth:authKeys.columns.type')}</th>
              <th className={thClass}>{t('auth:authKeys.columns.stream')}</th>
              <th className={thClass}>{t('auth:authKeys.columns.key')}</th>
              <th className={thClass}>{t('auth:authKeys.columns.description')}</th>
              <th className={thClass}>{t('auth:authKeys.columns.expiresAt')}</th>
              <th className={thClass}>{t('auth:authKeys.columns.autoRotate')}</th>
              <th className={`${thClass} text-right`}>{t('auth:authKeys.columns.actions')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {filtered.map(k => {
              const stream = streams.find(s => s.id === k.stream_id);
              return (
                <tr key={k.id} className="hover:bg-[var(--surface-hover)] transition-colors">
                  <td className={tdClass}>{t(`auth:authKeys.type.${k.type}`, k.type)}</td>
                  <td className={tdClass}>{stream?.name || '-'}</td>
                  <td className={tdClass}>
                    <span className="flex items-center gap-1.5 font-mono text-xs">
                      <code className="bg-[var(--muted)] px-2 py-1 rounded break-all">
                        {revealed[k.id] || k.key}
                      </code>
                      <button className={cn(btnGhost, 'shrink-0')} onClick={() => toggleReveal(k)} title={t(revealed[k.id] ? 'common:actions.hide' : 'common:actions.show')}>
                        {revealed[k.id] ? <EyeOff size={12} /> : <Eye size={12} />}
                      </button>
                      <button className={cn(btnGhost, 'shrink-0')} onClick={() => copyFullKey(k)} title={t('auth:authKeys.actions.copy')}>
                        <Copy size={12} />
                      </button>
                    </span>
                  </td>
                  <td className={tdClass}>{k.description || '-'}</td>
                  <td className={`${tdClass} whitespace-nowrap`}>{k.expires_at ? formatTime(k.expires_at) : t('auth:authKeys.status.neverExpires')}</td>
                  <td className={`${tdClass} whitespace-nowrap`}>{k.auto_rotate_days ? t('auth:authKeys.status.autoRotateDays', { days: k.auto_rotate_days }) : t('auth:authKeys.status.disabled')}</td>
                  <td className={tdClass}>
                    <div className="flex items-center justify-end gap-0.5">
                      <button
                        className={cn(btnGhost, 'text-[var(--warning)] hover:text-[var(--warning)]')}
                        onClick={() => setRotateTarget(k)}
                        title={t('auth:authKeys.actions.rotate')}
                      >
                        <RefreshCw size={14} />
                      </button>
                      <button className={btnGhost} onClick={() => openEdit(k)} title={t('common:actions.edit')}><Edit size={14} /></button>
                      <button
                        className={cn(btnGhost, 'text-[var(--destructive)] hover:text-[var(--destructive)] hover:bg-[var(--destructive)]/15')}
                        onClick={() => setDeleteTarget(k)}
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
        title={editing ? t('auth:authKeys.modal.edit') : t('auth:authKeys.modal.create')}
        footer={
          <>
            <button className={btnSecondary} onClick={() => setShowModal(false)}>{t('common:actions.cancel')}</button>
            <button className={btnPrimary} form="key-form" type="submit">
              {editing ? t('common:actions.save') : t('common:actions.create')}
            </button>
          </>
        }
      >
        <form id="key-form" onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>{t('auth:authKeys.modal.type')}</label>
              <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })} className={inputClass}>
                <option value="push">{t('auth:authKeys.type.push')}</option>
                <option value="pull">{t('auth:authKeys.type.pull')}</option>
              </select>
            </div>
            <div>
              <label className={labelClass}>{t('auth:authKeys.modal.stream')}</label>
              <select value={form.stream_id} onChange={e => setForm({ ...form, stream_id: e.target.value })} className={inputClass}>
                <option value="">{t('common:labels.selectPlaceholder')}</option>
                {streams.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className={labelClass}>{t('auth:authKeys.modal.description')}</label>
            <input
              type="text"
              value={form.description}
              onChange={e => setForm({ ...form, description: e.target.value })}
              className={inputClass}
              placeholder={t('auth:authKeys.modal.descriptionPlaceholder')}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>{t('auth:authKeys.modal.expiresAt')}</label>
              <input
                type="datetime-local"
                value={form.expires_at}
                onChange={e => setForm({ ...form, expires_at: e.target.value })}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>{t('auth:authKeys.modal.autoRotate')}</label>
              <input
                type="number"
                min={0}
                value={form.auto_rotate_days}
                onChange={e => setForm({ ...form, auto_rotate_days: e.target.value })}
                className={inputClass}
                placeholder={t('auth:authKeys.modal.autoRotatePlaceholder')}
              />
            </div>
          </div>
          {formError && <p className="text-[var(--destructive)] text-sm">{formError}</p>}
        </form>
      </Modal>

      {/* One-time full key display after create/rotate */}
      <Modal
        open={Boolean(newKey)}
        onClose={() => setNewKey(null)}
        title={t('auth:authKeys.showOnce.title')}
        size="sm"
        footer={<button className={btnPrimary} onClick={() => { copyKey(newKey); }}><Copy size={14} /> {t('common:actions.copy')}</button>}
      >
        <div className="space-y-3">
          <p className="text-sm text-[var(--warning)] flex items-start gap-2">
            <AlertTriangle size={16} className="shrink-0 mt-0.5" />
            {t('auth:authKeys.showOnce.warning')}
          </p>
          <code className="block bg-[var(--muted)] border rounded px-3 py-2.5 font-mono text-xs break-all select-all">{newKey}</code>
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(rotateTarget)}
        onClose={() => setRotateTarget(null)}
        onConfirm={confirmRotate}
        confirming={working}
        title={t('common:confirm.rotate.title')}
        description={t('common:confirm.rotate.description')}
        confirmLabel={t('common:confirm.rotate.confirm')}
      />
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        confirming={working}
        title={t('common:confirm.delete.title')}
        description={t('common:confirm.delete.description', { detail: deleteTarget?.description || deleteTarget?.key || '' })}
        confirmLabel={t('common:confirm.delete.confirm')}
      />
    </div>
  );
}
