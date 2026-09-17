import { useState } from 'react';
import { Copy, KeyRound, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../lib/api';
import { copyText } from '../../lib/clipboard';
import { btnDangerGhost, btnPrimary, btnSecondary, inputClass, labelClass } from '../ui/styles';
import ConfirmDialog from '../ui/ConfirmDialog';

export default function IngestCredentialPanel({ stream, credentials = [], onChanged }) {
  const [label, setLabel] = useState('');
  const [working, setWorking] = useState(false);
  const [issued, setIssued] = useState(null);
  const [confirmFirstEnable, setConfirmFirstEnable] = useState(false);
  const roomId = `room:${stream.id}`;
  const active = credentials.filter(item => item.status === 'ACTIVE');

  async function issueCredential() {
    if (!label.trim() || working) return;
    setWorking(true);
    try {
      const result = await api.post(`/v3/rooms/${roomId}/ingest-credentials`, { label: label.trim() });
      setIssued(result);
      setLabel('');
      setConfirmFirstEnable(false);
      await onChanged?.();
      toast.success('推流凭证已创建；密钥只显示这一次');
    } catch (error) {
      toast.error(error?.message || '创建推流凭证失败');
    } finally { setWorking(false); }
  }

  function createCredential(event) {
    event.preventDefault();
    if (!label.trim() || working) return;
    if (credentials.length === 0) { setConfirmFirstEnable(true); return; }
    void issueCredential();
  }

  async function revoke(credential) {
    if (working || credential.status === 'REVOKED') return;
    setWorking(true);
    try {
      await api.post(`/v3/rooms/${roomId}/ingest-credentials/${credential.id}/revoke`);
      await onChanged?.();
      toast.success('推流凭证已吊销；现有 Publisher 不会被伪装成已断开');
    } catch (error) {
      toast.error(error?.message || '吊销失败');
    } finally { setWorking(false); }
  }

  async function copy(value) {
    try { await copyText(value); toast.success('已复制'); } catch { toast.error('复制失败'); }
  }

  return (
    <section className="rounded-xl border border-[var(--border-soft)] bg-[var(--card)] p-4 shadow-[var(--shadow-panel)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2"><KeyRound size={15} className="text-[var(--primary)]" /><h2 className="text-sm font-semibold">IN-PUSH · 编码器推流来源</h2></div>
          <p className="mt-1 text-xs leading-5 text-[var(--muted-foreground)]">每台编码器使用独立随机推流码；启用后匿名推流关闭，内部 Worker 使用独立内部凭证。</p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-md bg-[var(--secondary)] px-2 py-1 text-[10px] text-[var(--muted-foreground)]"><ShieldCheck size={11} />{credentials.length ? `${active.length} ACTIVE` : 'LEGACY OPEN'}</span>
      </div>

      {issued && (
        <div className="mt-4 rounded-xl border border-[var(--warning)]/28 bg-[var(--warning-soft)]/15 p-3">
          <div className="text-xs font-semibold text-[var(--warning)]">新凭证只显示一次，请立即保存到编码器</div>
          <div className="mt-3 space-y-2">
            {[['Server', issued.server_url], ['Stream Key', issued.stream_key], ['Full URL', issued.publish_url]].map(([name, value]) => (
              <div key={name} className="grid gap-2 md:grid-cols-[74px_minmax(0,1fr)_auto] md:items-center">
                <span className="text-[10px] text-[var(--text-faint)]">{name}</span><code className="break-all text-[10px]">{value}</code>
                <button className={btnSecondary} onClick={() => copy(value)}><Copy size={12} />复制</button>
              </div>
            ))}
          </div>
          <button className="mt-3 text-[10px] text-[var(--muted-foreground)] underline" onClick={() => setIssued(null)}>我已保存，隐藏明文</button>
        </div>
      )}

      <div className="mt-4 space-y-2">
        {credentials.map(item => (
          <div key={item.id} className="grid gap-2 rounded-lg border border-[var(--border-soft)] bg-[var(--background)]/28 px-3 py-2.5 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
            <div className="min-w-0">
              <div className="flex items-center gap-2"><span className="truncate text-xs font-medium">{item.label}</span><span className={item.status === 'ACTIVE' ? 'text-[10px] text-[var(--success)]' : 'text-[10px] text-[var(--text-faint)]'}>{item.status}</span></div>
              <div className="mt-1 text-[10px] text-[var(--text-faint)]">Key ••••••{item.token_hint}{item.last_used_at ? ` · 最近使用 ${item.last_used_at}` : ' · 尚无使用证据'}</div>
            </div>
            <button className={btnDangerGhost} disabled={working || item.status !== 'ACTIVE'} onClick={() => revoke(item)}><Trash2 size={12} />吊销</button>
          </div>
        ))}
        {!credentials.length && <div className="rounded-lg border border-dashed border-[var(--border)] px-3 py-3 text-xs text-[var(--muted-foreground)]">当前保持旧版开放推流兼容。创建第一条凭证后，外部 Publisher 必须携带有效推流码。</div>}
      </div>

      <form className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end" onSubmit={createCredential}>
        <div><label className={labelClass}>来源名称</label><input className={inputClass} value={label} onChange={event => setLabel(event.target.value)} placeholder="主编码器 / 备编码器 / OBS" /></div>
        <button type="submit" className={btnPrimary} disabled={!label.trim() || working}><Plus size={13} />生成独立推流码</button>
      </form>

      <ConfirmDialog
        open={confirmFirstEnable}
        onClose={() => setConfirmFirstEnable(false)}
        onConfirm={issueCredential}
        confirming={working}
        title="启用推流凭据鉴权？"
        description="创建第一枚凭据后，这个直播间的匿名外部推流将被拒绝。当前已经连接的 Publisher 不会被系统伪装成已断开；请先保存新 Stream Key，并在下一次重连前更新编码器配置。"
        confirmLabel="启用并生成凭据"
      />
    </section>
  );
}
