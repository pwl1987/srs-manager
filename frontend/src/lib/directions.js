import { ArrowUpRight, Disc3, Eye, KeyRound, Link2 } from 'lucide-react';

// PHASE-09 direction taxonomy: a pure display layer over the workspace-v3
// contract vocabulary (source.kind IN_PUSH/IN_PULL, output.mode PUSH/SERVE/
// RECORD). Directions never carry color; color belongs to status projection
// (room-presentation.js).
export const DIRECTION_IDS = ['IN_PUSH', 'IN_PULL', 'OUT_PUSH', 'OUT_PULL', 'RECORD'];

const DIRECTIONS = {
  IN_PUSH: {
    id: 'IN_PUSH',
    sourceKind: 'IN_PUSH',
    outputMode: null,
    local: false,
    icon: KeyRound,
    labelKey: 'streams:directions.inPush.label',
    hintKey: 'streams:directions.inPush.hint'
  },
  IN_PULL: {
    id: 'IN_PULL',
    sourceKind: 'IN_PULL',
    outputMode: null,
    local: false,
    icon: Link2,
    labelKey: 'streams:directions.inPull.label',
    hintKey: 'streams:directions.inPull.hint'
  },
  OUT_PUSH: {
    id: 'OUT_PUSH',
    sourceKind: null,
    outputMode: 'PUSH',
    local: false,
    icon: ArrowUpRight,
    labelKey: 'streams:directions.outPush.label',
    hintKey: 'streams:directions.outPush.hint'
  },
  OUT_PULL: {
    id: 'OUT_PULL',
    sourceKind: null,
    outputMode: 'SERVE',
    local: false,
    icon: Eye,
    labelKey: 'streams:directions.outPull.label',
    hintKey: 'streams:directions.outPull.hint'
  },
  RECORD: {
    id: 'RECORD',
    sourceKind: null,
    outputMode: 'RECORD',
    local: true,
    icon: Disc3,
    labelKey: 'streams:directions.record.label',
    hintKey: 'streams:directions.record.hint'
  }
};

export function getDirection(id) {
  return DIRECTIONS[id] || null;
}

export function directionIdFromSourceKind(kind) {
  return kind === 'IN_PULL' ? 'IN_PULL' : (kind === 'IN_PUSH' ? 'IN_PUSH' : null);
}

export function directionIdFromOutputMode(mode) {
  if (mode === 'PUSH') return 'OUT_PUSH';
  if (mode === 'SERVE') return 'OUT_PULL';
  if (mode === 'RECORD') return 'RECORD';
  return null;
}

// Configured-only facts (PHASE-09 room_summary contract): input kinds come
// from the summary's configured kinds, output directions from the configured
// counters — serve_configured, never serve_enabled, so a paused OUT_PULL room
// is still findable by direction filter.
export function directionIdsFromRoomSummary(room) {
  const ids = new Set();
  for (const kind of room?.inputs?.kinds || []) {
    const id = directionIdFromSourceKind(kind);
    if (id) ids.add(id);
  }
  const outputs = room?.outputs || {};
  if (Number(outputs.push_total) > 0) ids.add('OUT_PUSH');
  if (outputs.serve_configured) ids.add('OUT_PULL');
  if (Number(outputs.record_total) > 0) ids.add('RECORD');
  return DIRECTION_IDS.filter(id => ids.has(id));
}

export function roomMatchesDirection(room, directionId) {
  if (directionId === 'all' || !directionId) return true;
  return directionIdsFromRoomSummary(room).includes(directionId);
}
