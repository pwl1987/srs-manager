import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowRight, Play, RefreshCw, Square, X } from 'lucide-react';
import { api } from '../../lib/api';
import { cn } from '../../lib/utils';
import { btnDangerGhost, btnPrimary, btnSecondary } from '../ui/styles';
import ConfirmDialog from '../ui/ConfirmDialog';
import WorkspacePreviewPanel from './WorkspacePreviewPanel';
import useSessionCommands from './use-session-commands';
import { startRoomWorkspacePolling } from './room-workspace-poll';
import { projectRoomPresentation, TONE_BADGE_CLASS, TONE_DOT_CLASS } from '../../lib/room-presentation';
import { formatBitrateKbps, formatDuration } from '../../i18n/format';

function Fact({ label, value, hint }) {
  return <div className="min-w-0"><div className="text-[9px] font-semibold tracking-[.12em] text-[var(--text-faint)]">{label}</div><div className="mt-1 truncate text-xs font-medium text-[var(--foreground)]">{value}</div>{hint && <div className="mt-0.5 truncate text-[10px] text-[var(--muted-foreground)]">{hint}</div>}</div>;
}

const SESSION_STATE_KEYS = {
  PREP: 'streams:liveOps.sessionState.PREP',
  READY: 'streams:liveOps.sessionState.READY',
  ON_AIR: 'streams:liveOps.sessionState.ON_AIR',
  CLOSING: 'streams:liveOps.sessionState.CLOSING',
  ENDED: 'streams:liveOps.sessionState.ENDED'
};

const PROGRAM_STATE_KEYS = {
  LIVE: 'streams:liveOps.programState.LIVE',
  NO_PROGRAM: 'streams:liveOps.programState.NO_PROGRAM',
  READY: 'streams:liveOps.programState.READY',
  SWITCHING: 'streams:liveOps.programState.SWITCHING',
  VERIFYING: 'streams:liveOps.programState.VERIFYING',
  UNKNOWN: 'streams:liveOps.programState.UNKNOWN'
};

// Close-session confirmation shared with the full workspace: same copy, same
// shared closeSession command — only the trigger lives in this panel.
export function CloseSessionConfirm({ open, busy = false, onCancel, onConfirm, t }) {
  return <ConfirmDialog
    open={open}
    onClose={onCancel}
    onConfirm={onConfirm}
    confirming={busy}
    title={t('streams:sessionBar.close.title')}
    description={t('streams:sessionBar.close.description')}
    confirmLabel={t('streams:sessionBar.close.confirm')} />;
}

// PHASE-09 main-entry right panel: confirm state + preview + high-frequency
// lifecycle actions + entry into the full workspace. Anything deeper stays in
// /streams/:id on purpose.
export default function RoomCommandPanel({ room, onClose, initialWorkspace = null, initialError = null }) {
  const { t } = useTranslation('streams');
  const roomId = room?.room?.id;
  const legacyStreamId = room?.room?.legacy_stream_id;
  const [workspace, setWorkspace] = useState(initialWorkspace);
  const [error, setError] = useState(initialError);
  const [confirmClose, setConfirmClose] = useState(false);
  const pollerRef = useRef(null);

  useEffect(() => {
    if (!roomId) return undefined;
    const wiring = startRoomWorkspacePolling({
      roomId,
      fetchWorkspace: () => api.get(`/v3/rooms/${roomId}/workspace`),
      onWorkspace: next => { setError(null); setWorkspace(next); },
      onError: err => setError(err)
    });
    pollerRef.current = wiring.poller;
    return () => {
      wiring.dispose();
      pollerRef.current = null;
    };
  }, [roomId]);

  const presentation = projectRoomPresentation(room);
  const session = workspace?.session || null;
  const commands = useSessionCommands({ roomId, session, onChanged: () => pollerRef.current?.refresh() });
  const observedOnline = Boolean(workspace?.observed?.online || workspace?.program?.state === 'LIVE');
  const required = Number(room?.outputs?.required_total || 0);
  const requiredHealthy = Number(room?.outputs?.required_healthy || 0);
  const programStateKey = PROGRAM_STATE_KEYS[workspace?.program?.state] || PROGRAM_STATE_KEYS.UNKNOWN;
  const lifecycle = session?.lifecycle_state || null;

  return <div className="flex h-full min-h-0 flex-col gap-3" data-room-panel={roomId || ''}>
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <div className="text-[9px] font-semibold tracking-[.14em] text-[var(--text-faint)]">{t('streams:liveOps.roomPanel.title')}</div>
        <div className="mt-1 flex items-center gap-2">
          <span className={cn('h-2 w-2 shrink-0 rounded-full', TONE_DOT_CLASS[presentation.tone])} />
          <span className="truncate text-sm font-semibold">{room?.room?.name}</span>
          <span className={cn('inline-flex items-center rounded-md border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[.08em]', TONE_BADGE_CLASS[presentation.tone])}>{t(presentation.labelKey)}</span>
        </div>
        {room?.room?.business_unit && <div className="mt-1 truncate text-[10px] text-[var(--muted-foreground)]">{room.room.business_unit}{room?.room?.remark ? ` · ${room.room.remark}` : ''}</div>}
      </div>
      {onClose && <button type="button" className={btnSecondary} onClick={onClose} aria-label={t('streams:liveOps.roomPanel.close')}><X size={13} /></button>}
    </div>

    {error && <div className="rounded-lg border border-[var(--destructive)]/20 bg-[var(--destructive)]/7 px-3 py-2 text-[10px] text-[var(--destructive)]">{error.message || t('streams:liveOps.roomPanel.loadFailed')}</div>}

    <div className="grid grid-cols-2 gap-2 rounded-xl border border-[var(--border-soft)] bg-[var(--card)] px-3 py-2.5 sm:grid-cols-4">
      <Fact label={t('streams:liveOps.roomPanel.facts.program')} value={t(programStateKey)} hint={workspace?.program?.bitrate != null ? formatBitrateKbps(workspace.program.bitrate) : undefined} />
      <Fact label={t('streams:liveOps.roomPanel.facts.session')} value={lifecycle ? t(SESSION_STATE_KEYS[lifecycle]) : t('streams:liveOps.roomPanel.sessionNone')} hint={session?.title} />
      <Fact label={t('streams:liveOps.roomPanel.facts.requiredOutputs')} value={required ? `${requiredHealthy} / ${required}` : '—'} />
      <Fact label={t('streams:liveOps.roomPanel.facts.duration')} value={observedOnline && workspace?.program?.uptime_seconds != null ? formatDuration(workspace.program.uptime_seconds) : '—'} hint={workspace?.program?.viewers != null ? t('streams:liveOps.roomPanel.viewers', { count: workspace.program.viewers }) : undefined} />
    </div>

    <div className="min-h-0">
      {legacyStreamId != null
        ? <WorkspacePreviewPanel stream={{ id: legacyStreamId, name: room?.room?.name }} observed={{ online: observedOnline }} t={t} />
        : <div className="aspect-video rounded-2xl border border-dashed border-[var(--border)]" />}
    </div>

    <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--card)] px-3 py-3">
      {!session && <div className="text-[10px] leading-5 text-[var(--muted-foreground)]">{t('streams:liveOps.roomPanel.noSessionHint')}</div>}
      <div className="mt-2 flex flex-wrap gap-2">
        {lifecycle === 'PREP' && <button type="button" className={btnSecondary} disabled={commands.busy} onClick={commands.runPreflight}><RefreshCw size={13} />{t('streams:liveOps.roomPanel.actions.preflight')}</button>}
        {lifecycle === 'READY' && <button type="button" className={btnSecondary} disabled={commands.busy} onClick={commands.runPreflight}><RefreshCw size={13} />{t('streams:liveOps.roomPanel.actions.preflight')}</button>}
        {lifecycle === 'READY' && <button type="button" className={btnPrimary} disabled={commands.busy} onClick={commands.startSession}><Play size={13} />{t('streams:liveOps.roomPanel.actions.start')}</button>}
        {lifecycle === 'ON_AIR' && <button type="button" className={btnDangerGhost} disabled={commands.busy} onClick={() => setConfirmClose(true)}><Square size={12} />{t('streams:liveOps.roomPanel.actions.close')}</button>}
        {lifecycle === 'CLOSING' && <button type="button" className={btnSecondary} disabled={commands.busy} onClick={commands.closeSession}><RefreshCw size={12} />{t('streams:liveOps.roomPanel.actions.continueClosing')}</button>}
        {lifecycle === 'ENDED' && <span className="text-[10px] text-[var(--muted-foreground)]">{t('streams:liveOps.roomPanel.actions.ended')}</span>}
      </div>
      {room?.active_incidents > 0 && <div className="mt-2 text-[10px] text-[var(--warning)]">{t('streams:liveOps.roomPanel.incidents', { count: room.active_incidents })}</div>}
    </div>

    {/* Ending the broadcast is gated by the same confirmation as the full
        workspace; the shared closeSession command does the actual work. */}
    <CloseSessionConfirm
      open={confirmClose}
      busy={commands.busy}
      onCancel={() => setConfirmClose(false)}
      onConfirm={() => { setConfirmClose(false); commands.closeSession(); }}
      t={t} />

    <Link className={btnPrimary} to={`/streams/${legacyStreamId}`}>
      {t('streams:liveOps.roomPanel.enterWorkspace')}<ArrowRight size={13} />
    </Link>
  </div>;
}
