import { useEffect, useMemo, useState } from 'react';
import { Film, Play, Plus, RefreshCw, Settings2, Square, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { api } from '../../lib/api';
import { cn } from '../../lib/utils';
import { btnDangerGhost, btnGhost, btnPrimary, btnSecondary, inputClass, labelClass } from '../ui/styles';

function RuntimeBadge({ state, observed }) {
  const tone = observed
    ? 'bg-[var(--success-soft)] text-[var(--success)]'
    : state === 'FAILED'
      ? 'bg-[var(--destructive)]/10 text-[var(--destructive)]'
      : ['STARTING', 'RETRYING', 'WAITING_INPUT'].includes(state)
        ? 'bg-[var(--warning-soft)] text-[var(--warning)]'
        : 'bg-[var(--secondary)] text-[var(--muted-foreground)]';
  return <span className={cn('rounded-md px-2 py-1 text-[10px] font-semibold', tone)}>{observed ? 'OBSERVED' : state || 'STOPPED'}</span>;
}

export default function TranscodePipelinePanel({ workspace, stream, t, onChanged }) {
  const bindings = workspace.processing?.transcodes || [];
  const worker = workspace.processing?.worker || { available: false };
  const [templates, setTemplates] = useState([]);
  const [showCreate, setShowCreate] = useState(false);
  const [working, setWorking] = useState(false);
  const [form, setForm] = useState({ template_id: '', role: 'main', output_suffix: 'main' });

  useEffect(() => {
    api.get('/transcode-templates')
      .then(rows => setTemplates((Array.isArray(rows) ? rows : []).filter(row => row.enabled)))
      .catch(() => setTemplates([]));
  }, []);

  const selectedTemplate = useMemo(
    () => templates.find(item => String(item.id) === String(form.template_id)),
    [templates, form.template_id]
  );

  async function mutate(fn, success) {
    setWorking(true);
    try {
      await fn();
      toast.success(success);
      await onChanged?.();
    } catch (error) {
      toast.error(error.message || t('common:errors.INTERNAL_GENERAL'));
    } finally {
      setWorking(false);
    }
  }

  async function create(event) {
    event.preventDefault();
    if (!form.template_id || !form.output_suffix.trim()) return;
    await mutate(
      () => api.post('/transcode-bindings', {
        stream_id: stream.id,
        template_id: Number(form.template_id),
        role: form.role,
        output_suffix: form.output_suffix.trim().toLowerCase(),
        sort_order: bindings.length * 10 + 10
      }),
      t('streams:workspace.processing.created')
    );
    setShowCreate(false);
    setForm({ template_id: '', role: 'main', output_suffix: 'main' });
  }

  async function control(binding, action) {
    await mutate(
      () => api.post(`/transcode-bindings/${binding.id}/${action}`),
      t('streams:workspace.processing.updated')
    );
  }

  async function remove(binding) {
    await mutate(
      () => api.delete(`/transcode-bindings/${binding.id}`),
      t('streams:workspace.processing.deleted')
    );
  }

  return (
    <section className="rounded-xl border border-[var(--border-soft)] bg-[var(--card)] p-4 shadow-[var(--shadow-panel)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2"><Film size={15} className="text-[var(--info)]" /><h2 className="text-sm font-semibold">{t('streams:workspace.processing.title')}</h2></div>
          <p className="mt-1 text-xs leading-5 text-[var(--muted-foreground)]">{t('streams:workspace.processing.runtimeSubtitle')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className={cn('inline-flex items-center rounded-md px-2 py-1 text-[10px] font-semibold', worker.available ? 'bg-[var(--success-soft)] text-[var(--success)]' : 'bg-[var(--warning-soft)] text-[var(--warning)]')}>
            {worker.available ? t('streams:workspace.processing.workerOnline') : t('streams:workspace.processing.workerOffline')}
          </span>
          <Link to="/transcode" className={btnSecondary}><Settings2 size={13} />{t('streams:workspace.processing.manageTemplates')}</Link>
          <button className={btnPrimary} onClick={() => setShowCreate(value => !value)}><Plus size={13} />{t('streams:workspace.processing.mount')}</button>
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-[var(--success)]/18 bg-[var(--success-soft)]/12 p-3">
        <div className="text-[10px] font-semibold text-[var(--success)]">PASSTHROUGH</div>
        <div className="mt-1 text-sm font-medium">{t('streams:workspace.processing.passthroughTitle')}</div>
        <p className="mt-1 text-[10px] leading-4 text-[var(--muted-foreground)]">{t('streams:workspace.processing.passthroughHint')}</p>
      </div>

      {showCreate && (
        <form onSubmit={create} className="mt-3 grid gap-3 rounded-xl border border-[var(--info)]/18 bg-[var(--background)]/25 p-3 md:grid-cols-[1.3fr_.7fr_.8fr_auto] md:items-end">
          <div><label className={labelClass}>{t('streams:workspace.processing.template')}</label><select className={inputClass} value={form.template_id} onChange={e => setForm({ ...form, template_id: e.target.value })} required><option value="">{t('streams:workspace.processing.selectTemplate')}</option>{templates.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
          <div><label className={labelClass}>{t('streams:workspace.processing.role')}</label><select className={inputClass} value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}><option value="main">MAIN</option><option value="secondary">SECONDARY</option><option value="audio">AUDIO</option><option value="custom">CUSTOM</option></select></div>
          <div><label className={labelClass}>{t('streams:workspace.processing.suffix')}</label><input className={`${inputClass} font-mono`} value={form.output_suffix} onChange={e => setForm({ ...form, output_suffix: e.target.value })} placeholder="main / 720p / audio" required /></div>
          <button className={btnPrimary} disabled={working || !selectedTemplate} type="submit">{t('streams:workspace.processing.saveMount')}</button>
        </form>
      )}

      <div className="mt-3 space-y-2">
        {bindings.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[var(--border-soft)] p-4 text-xs text-[var(--muted-foreground)]">{t('streams:workspace.processing.empty')}</div>
        ) : bindings.map(binding => {
          const observed = binding.observed?.online === true;
          const canDelete = binding.desired_state === 'STOPPED' && binding.runtime_state === 'STOPPED';
          return (
            <div key={binding.id} className="rounded-xl border border-[var(--border-soft)] bg-[var(--background)]/22 p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2"><span className="text-sm font-semibold">{binding.template_name}</span><span className="rounded-md bg-[var(--secondary)] px-2 py-0.5 text-[9px] font-semibold">{String(binding.role).toUpperCase()}</span><RuntimeBadge state={binding.runtime_state} observed={observed} /></div>
                  <div className="mt-1 font-mono text-[10px] text-[var(--muted-foreground)]">live/{binding.output_stream_name}</div>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-[var(--muted-foreground)]">
                    <span>Desired: {binding.desired_state}</span>
                    <span>{binding.template?.vcodec === 'none' ? 'AUDIO ONLY' : `${binding.template?.video_config?.width || '—'}×${binding.template?.video_config?.height || '—'} · ${binding.template?.video_config?.bitrate || '—'} kbps`}</span>
                    {observed && <span>{binding.observed?.bitrate || 0} kbps · {binding.observed?.viewers || 0} viewers</span>}
                  </div>
                  {binding.last_error && <div className="mt-2 max-w-3xl break-words font-mono text-[10px] text-[var(--destructive)]">{binding.last_error}</div>}
                </div>
                <div className="flex shrink-0 gap-1">
                  {binding.desired_state === 'STOPPED' && binding.runtime_state !== 'FAILED' && <button className={btnGhost} disabled={working || !worker.available} onClick={() => control(binding, 'start')} title={t('streams:workspace.processing.start')}><Play size={13} /></button>}
                  {binding.desired_state === 'RUNNING' && <button className={btnGhost} disabled={working} onClick={() => control(binding, 'stop')} title={t('streams:workspace.processing.stop')}><Square size={13} /></button>}
                  {binding.runtime_state === 'FAILED' && <button className={btnGhost} disabled={working || !worker.available} onClick={() => control(binding, 'retry')} title={t('streams:workspace.processing.retry')}><RefreshCw size={13} /></button>}
                  <button className={btnDangerGhost} disabled={working || !canDelete} onClick={() => remove(binding)} title={t('streams:workspace.processing.unmount')}><Trash2 size={13} /></button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-[10px] leading-4 text-[var(--text-faint)]">{t('streams:workspace.processing.pipelineHint')}</p>
    </section>
  );
}
