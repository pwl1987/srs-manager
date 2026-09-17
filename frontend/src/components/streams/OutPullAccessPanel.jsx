import { useState } from 'react';
import { Copy, Eye, KeyRound, ShieldCheck, ShieldOff, Users, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../lib/api';
import { cn } from '../../lib/utils';
import { copyText } from '../../lib/clipboard';
import { getErrorCode } from '../../lib/error-mapper';
import { directFlvUrl, directRtmpUrl } from '../../lib/stream-url-display';
import { btnDangerGhost, btnGhost, btnPrimary, btnSecondary, inputClass, labelClass } from '../ui/styles';

function appendToken(url, token) {
  if (!url || !token) return url;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}access_token=${encodeURIComponent(token)}`;
}

function PolicyButton({ active, icon: Icon, label, onClick, disabled }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex min-h-10 items-center gap-2 rounded-lg border px-3 text-xs font-medium transition-colors disabled:opacity-50',
        active
          ? 'border-[var(--success)]/25 bg-[var(--success-soft)] text-[var(--success)]'
          : 'border-[var(--warning)]/25 bg-[var(--warning-soft)] text-[var(--warning)]'
      )}
    >
      <Icon size={13} />{label}
    </button>
  );
}

export default function OutPullAccessPanel({ workspace, stream, t, onChanged, onDisconnectViewers }) {
  const outPull = workspace.outputs?.out_pull || {};
  const policy = outPull.policy || { endpoint_enabled: true, accepting_new_sessions: true, require_grant: false };
  const grants = outPull.grants || [];
  const [working, setWorking] = useState(false);
  const [label, setLabel] = useState('');
  const [duration, setDuration] = useState('24');
  const [issued, setIssued] = useState(null);
  async function updatePolicy(patch) {
    setWorking(true);
    try {
      await api.put(`/out-pull/streams/${stream.id}/policy`, patch);
      toast.success(t('streams:workspace.outPull.updated'));
      await onChanged?.();
    } catch (error) {
      toast.error(t(`common:errors.${getErrorCode(error)}`));
    } finally {
      setWorking(false);
    }
  }

  async function createGrant(event) {
    event.preventDefault();
    if (!label.trim()) return;
    setWorking(true);
    try {
      const expiresAt = new Date(Date.now() + Number(duration) * 3600000).toISOString();
      const grant = await api.post(`/out-pull/streams/${stream.id}/grants`, {
        label: label.trim(),
        expires_at: expiresAt
      });
      setIssued(grant);
      setLabel('');
      toast.success(t('streams:workspace.outPull.grantCreated'));
      await onChanged?.();
    } catch (error) {
      toast.error(t(`common:errors.${getErrorCode(error)}`));
    } finally {
      setWorking(false);
    }
  }

  async function revokeGrant(grant) {
    setWorking(true);
    try {
      await api.post(`/out-pull/streams/${stream.id}/grants/${grant.id}/revoke`);
      toast.success(t('streams:workspace.outPull.grantRevoked'));
      await onChanged?.();
    } catch (error) {
      toast.error(t(`common:errors.${getErrorCode(error)}`));
    } finally {
      setWorking(false);
    }
  }

  async function copy(value) {
    try {
      await copyText(value);
      toast.success(t('common:toasts.copied'));
    } catch {
      toast.error(t('common:errors.INTERNAL_GENERAL'));
    }
  }
  const originUrls = {
    flv: directFlvUrl(stream.name, stream.http_port || 8080),
    rtmp: directRtmpUrl(stream.name, stream.rtmp_port || 1935)
  };
  const issuedUrls = issued?.token ? {
    hls: appendToken(originUrls.hls, issued.token),
    flv: appendToken(originUrls.flv, issued.token),
    rtmp: appendToken(originUrls.rtmp, issued.token)
  } : null;

  return (
    <section className="rounded-xl border border-[var(--border-soft)] bg-[var(--card)] p-4 shadow-[var(--shadow-panel)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Eye size={15} className="text-[var(--info)]" />
            <h2 className="text-sm font-semibold">{t('streams:workspace.outPull.title')}</h2>
          </div>
          <p className="mt-1 text-xs leading-5 text-[var(--muted-foreground)]">{t('streams:workspace.outPull.subtitle')}</p>
        </div>
        <span className="rounded-md bg-[var(--secondary)] px-2 py-1 text-[10px] text-[var(--muted-foreground)]">
          {workspace.observed?.players?.count ?? '—'} {t('streams:workspace.outPull.currentSessions')}
        </span>
      </div>

      <div className="mt-4 grid gap-2 md:grid-cols-3">
        <PolicyButton
          active={policy.endpoint_enabled}
          icon={policy.endpoint_enabled ? ShieldCheck : ShieldOff}
          label={policy.endpoint_enabled ? t('streams:workspace.outPull.endpointEnabled') : t('streams:workspace.outPull.endpointDisabled')}
          onClick={() => updatePolicy({ endpoint_enabled: !policy.endpoint_enabled })}
          disabled={working}
        />
        <PolicyButton
          active={policy.accepting_new_sessions}
          icon={policy.accepting_new_sessions ? Users : XCircle}
          label={policy.accepting_new_sessions ? t('streams:workspace.outPull.accepting') : t('streams:workspace.outPull.paused')}
          onClick={() => updatePolicy({ accepting_new_sessions: !policy.accepting_new_sessions })}
          disabled={working}
        />
        <PolicyButton
          active={policy.require_grant}
          icon={KeyRound}
          label={policy.require_grant ? t('streams:workspace.outPull.grantRequired') : t('streams:workspace.outPull.openAccess')}
          onClick={() => updatePolicy({ require_grant: !policy.require_grant })}
          disabled={working}
        />
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--border-soft)] bg-[var(--background)]/25 p-3">
        <div>
          <div className="text-xs font-semibold">{t('streams:workspace.outPull.sessionControl')}</div>
          <div className="mt-1 text-[10px] leading-4 text-[var(--text-faint)]">{t('streams:workspace.outPull.sessionControlHint')}</div>
        </div>
        <button className={btnDangerGhost} disabled={!workspace.capabilities?.disconnect_viewers} onClick={onDisconnectViewers}>
          <Users size={13} />{t('streams:workspace.outPull.disconnectCurrent')}
        </button>
      </div>

      <form onSubmit={createGrant} className="mt-4 rounded-lg border border-[var(--border-soft)] bg-[var(--background)]/20 p-3">
        <div className="text-xs font-semibold">{t('streams:workspace.outPull.createGrant')}</div>
        <div className="mt-3 grid gap-2 md:grid-cols-[minmax(0,1fr)_160px_auto]">
          <div>
            <label className={labelClass}>{t('streams:workspace.outPull.grantLabel')}</label>
            <input className={inputClass} value={label} onChange={event => setLabel(event.target.value)} placeholder={t('streams:workspace.outPull.grantLabelPlaceholder')} />
          </div>
          <div>
            <label className={labelClass}>{t('streams:workspace.outPull.validFor')}</label>
            <select className={inputClass} value={duration} onChange={event => setDuration(event.target.value)}>
              <option value="1">1 {t('streams:workspace.outPull.hours')}</option>
              <option value="24">24 {t('streams:workspace.outPull.hours')}</option>
              <option value="168">7 {t('streams:workspace.outPull.days')}</option>
            </select>
          </div>
          <button className={`${btnPrimary} self-end`} disabled={working || !label.trim()} type="submit">
            <KeyRound size={13} />{t('streams:workspace.outPull.issueGrant')}
          </button>
        </div>
      </form>

      {issued?.token && (
        <div className="mt-3 rounded-lg border border-[var(--success)]/25 bg-[var(--success-soft)]/35 p-3">
          <div className="text-xs font-semibold text-[var(--success)]">{t('streams:workspace.outPull.tokenOnce')}</div>
          <div className="mt-2 flex items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded bg-black/15 px-2 py-1.5 text-[10px]">{issued.token}</code>
            <button className={btnGhost} onClick={() => copy(issued.token)}><Copy size={13} /></button>
          </div>
          <div className="mt-3 space-y-2">
            {Object.entries(issuedUrls).map(([protocol, url]) => (
              <div key={protocol} className="grid gap-2 md:grid-cols-[46px_minmax(0,1fr)_auto] md:items-center">
                <span className="text-[10px] font-semibold uppercase text-[var(--muted-foreground)]">{protocol}</span>
                <code className="break-all text-[10px] text-[var(--muted-foreground)]">{url}</code>
                <button className={btnGhost} onClick={() => copy(url)}><Copy size={13} /></button>
              </div>
            ))}
          </div>
        </div>
      )}
      {grants.length > 0 && (
        <div className="mt-4">
          <div className="mb-2 text-xs font-semibold">{t('streams:workspace.outPull.grants')}</div>
          <div className="space-y-2">
            {grants.slice(0, 8).map(grant => (
              <div key={grant.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--border-soft)] bg-[var(--background)]/20 px-3 py-2.5">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-medium">{grant.label}</span>
                    <span className={cn(
                      'rounded px-1.5 py-0.5 text-[9px] font-semibold',
                      grant.status === 'ACTIVE' ? 'bg-[var(--success-soft)] text-[var(--success)]' : 'bg-[var(--secondary)] text-[var(--muted-foreground)]'
                    )}>{grant.status}</span>
                  </div>
                  <div className="mt-1 text-[10px] text-[var(--text-faint)]">••••{grant.token_hint} · {new Date(grant.expires_at).toLocaleString()}</div>
                </div>
                {grant.status === 'ACTIVE' && (
                  <button className={btnDangerGhost} disabled={working} onClick={() => revokeGrant(grant)}>{t('streams:workspace.outPull.revoke')}</button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="mt-4 border-t border-[var(--border-soft)] pt-3 text-[10px] leading-4 text-[var(--text-faint)]">
        {t('streams:workspace.outPull.originOnlyHint')}
      </p>
    </section>
  );
}
