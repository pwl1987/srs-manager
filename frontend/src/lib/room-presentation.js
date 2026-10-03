// PHASE-09 status projection: the single source of truth every main-entry
// surface (stat cards, status filter, list rows, right panel) must call.
// bucket is the business four-bucket view; tone is the color four-color rule:
// green = running healthy, yellow = attention/waiting/partial, red = fault or
// explicit risk, gray = not running / not configured. Blue stays reserved for
// selection/control and never appears here.
export const ROOM_BUCKETS = ['running', 'attention', 'fault', 'idle'];

const BUCKET_TONE = { fault: 'danger', attention: 'warning', running: 'healthy', idle: 'muted' };
const BUCKET_LABEL_KEY = {
  fault: 'streams:roomState.fault',
  attention: 'streams:roomState.attention',
  running: 'streams:roomState.running',
  idle: 'streams:roomState.idle'
};

export const TONE_DOT_CLASS = {
  danger: 'bg-[var(--destructive)]',
  warning: 'bg-[var(--warning)]',
  healthy: 'bg-[var(--success)]',
  muted: 'bg-[var(--text-faint)]'
};

export const TONE_TEXT_CLASS = {
  danger: 'text-[var(--destructive)]',
  warning: 'text-[var(--warning)]',
  healthy: 'text-[var(--success)]',
  muted: 'text-[var(--muted-foreground)]'
};

export const TONE_BADGE_CLASS = {
  danger: 'border-[var(--destructive)]/20 bg-[var(--destructive)]/7 text-[var(--destructive)]',
  warning: 'border-[var(--warning)]/20 bg-[var(--warning)]/7 text-[var(--warning)]',
  healthy: 'border-[var(--success)]/20 bg-[var(--success)]/7 text-[var(--success)]',
  muted: 'border-[var(--border-soft)] bg-[var(--secondary)] text-[var(--muted-foreground)]'
};

export const TONE_ROW_CLASS = {
  danger: 'border-[var(--destructive)]/24',
  warning: 'border-[var(--warning)]/22',
  healthy: 'border-[var(--border-soft)]',
  muted: 'border-[var(--border-soft)]'
};

export function projectRoomPresentation(room) {
  const reasonKeys = [];
  const criticalIncidents = Number(room?.critical_incidents || 0);
  const activeIncidents = Number(room?.active_incidents || 0);
  const health = room?.health?.status;
  const lifecycle = room?.session?.lifecycle_state || null;
  const programState = room?.program?.state || null;
  const legacyStatus = room?.compatibility?.legacy_stream_status || null;
  const onAir = lifecycle === 'ON_AIR' || programState === 'LIVE';
  // Live-but-unknown-evidence rooms are attention; fully idle unknown rooms
  // stay gray (contract: unknown_not_failure, context decides).
  const onlineEvidenceUnknown = programState === 'UNKNOWN' && legacyStatus === 'online';

  // Fixed priority: fault > attention > running > idle.
  let bucket = 'idle';
  if (criticalIncidents > 0) {
    bucket = 'fault';
    reasonKeys.push('CRITICAL_INCIDENTS');
  } else if (health === 'CRITICAL') {
    bucket = 'fault';
    reasonKeys.push('HEALTH_CRITICAL');
  } else if (activeIncidents > 0) {
    bucket = 'attention';
    reasonKeys.push('ACTIVE_INCIDENTS');
  } else if (health === 'DEGRADED') {
    bucket = 'attention';
    reasonKeys.push('HEALTH_DEGRADED');
  } else if (onlineEvidenceUnknown) {
    bucket = 'attention';
    reasonKeys.push('PROGRAM_EVIDENCE_UNKNOWN');
  } else if (onAir) {
    bucket = 'running';
    reasonKeys.push('ON_AIR');
  }

  let tone = BUCKET_TONE[bucket];
  // READY/PREP wait visually in yellow but still count as 未运行.
  if (bucket === 'idle' && (lifecycle === 'READY' || lifecycle === 'PREP')) tone = 'warning';

  return {
    bucket,
    tone,
    labelKey: BUCKET_LABEL_KEY[bucket],
    reasonKeys,
    onAir,
    lifecycle,
    programState
  };
}

export function roomMatchesBucket(room, bucket) {
  if (bucket === 'all' || !bucket) return true;
  return projectRoomPresentation(room).bucket === bucket;
}
