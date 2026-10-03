import { describe, expect, it } from 'vitest';
import { ROOM_BUCKETS, projectRoomPresentation, roomMatchesBucket } from './room-presentation';

function room(overrides = {}) {
  return {
    room: { id: 'room:1' },
    session: null,
    program: { state: 'NO_PROGRAM' },
    outputs: {},
    health: { status: 'NORMAL' },
    active_incidents: 0,
    critical_incidents: 0,
    compatibility: { legacy_stream_status: 'offline' },
    ...overrides
  };
}

describe('projectRoomPresentation four-bucket projection', () => {
  it('prioritizes fault over attention, running and idle', () => {
    const both = room({
      session: { lifecycle_state: 'ON_AIR' },
      program: { state: 'LIVE' },
      health: { status: 'DEGRADED' },
      active_incidents: 3,
      critical_incidents: 1
    });
    const projected = projectRoomPresentation(both);
    expect(projected.bucket).toBe('fault');
    expect(projected.tone).toBe('danger');
    expect(projected.reasonKeys).toContain('CRITICAL_INCIDENTS');
  });

  it('maps CRITICAL health to the fault bucket with its own reason', () => {
    const projected = projectRoomPresentation(room({ session: { lifecycle_state: 'ON_AIR' }, program: { state: 'LIVE' }, health: { status: 'CRITICAL' } }));
    expect(projected.bucket).toBe('fault');
    expect(projected.reasonKeys).toContain('HEALTH_CRITICAL');
  });

  it('maps healthy ON_AIR rooms to the running bucket', () => {
    const projected = projectRoomPresentation(room({ session: { lifecycle_state: 'ON_AIR' }, program: { state: 'LIVE' } }));
    expect(projected.bucket).toBe('running');
    expect(projected.tone).toBe('healthy');
    expect(projected.onAir).toBe(true);
  });

  it('maps DEGRADED health or active incidents to attention', () => {
    expect(projectRoomPresentation(room({ health: { status: 'DEGRADED' } })).bucket).toBe('attention');
    expect(projectRoomPresentation(room({ active_incidents: 2 })).bucket).toBe('attention');
    expect(projectRoomPresentation(room({ active_incidents: 2 })).tone).toBe('warning');
  });

  it('keeps READY/PREP in the idle bucket but paints the wait yellow', () => {
    for (const lifecycle_state of ['READY', 'PREP']) {
      const projected = projectRoomPresentation(room({ session: { lifecycle_state } }));
      expect(projected.bucket).toBe('idle');
      expect(projected.tone).toBe('warning');
    }
    expect(projectRoomPresentation(room({ session: { lifecycle_state: 'ENDED' } }))).toEqual(
      expect.objectContaining({ bucket: 'idle', tone: 'muted' })
    );
  });

  it('treats live-but-unknown evidence as attention, fully idle unknown as gray', () => {
    const liveUnknown = projectRoomPresentation(room({
      program: { state: 'UNKNOWN' },
      compatibility: { legacy_stream_status: 'online' }
    }));
    expect(liveUnknown.bucket).toBe('attention');
    expect(liveUnknown.reasonKeys).toContain('PROGRAM_EVIDENCE_UNKNOWN');

    const idleUnknown = projectRoomPresentation(room({ program: { state: 'UNKNOWN' } }));
    expect(idleUnknown.bucket).toBe('idle');
    expect(idleUnknown.tone).toBe('muted');
  });

  it('filters rooms by bucket through the same projection', () => {
    const running = room({ session: { lifecycle_state: 'ON_AIR' }, program: { state: 'LIVE' } });
    expect(roomMatchesBucket(running, 'running')).toBe(true);
    expect(roomMatchesBucket(running, 'idle')).toBe(false);
    expect(roomMatchesBucket(running, 'all')).toBe(true);
    expect(ROOM_BUCKETS).toEqual(['running', 'attention', 'fault', 'idle']);
  });
});
