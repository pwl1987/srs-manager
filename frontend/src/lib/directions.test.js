import { describe, expect, it } from 'vitest';
import {
  DIRECTION_IDS,
  directionIdFromOutputMode,
  directionIdFromSourceKind,
  directionIdsFromRoomSummary,
  getDirection,
  roomMatchesDirection
} from './directions';

describe('direction taxonomy display mapping', () => {
  it('maps contract vocabulary onto the four directions plus RECORD', () => {
    expect(directionIdFromSourceKind('IN_PUSH')).toBe('IN_PUSH');
    expect(directionIdFromSourceKind('IN_PULL')).toBe('IN_PULL');
    expect(directionIdFromOutputMode('PUSH')).toBe('OUT_PUSH');
    expect(directionIdFromOutputMode('SERVE')).toBe('OUT_PULL');
    expect(directionIdFromOutputMode('RECORD')).toBe('RECORD');
    expect(directionIdFromSourceKind('UNKNOWN')).toBeNull();
  });

  it('derives configured direction facts from a room summary', () => {
    const room = {
      inputs: { kinds: ['IN_PUSH', 'IN_PULL'], push_credentials: 2, pull_tasks: 1 },
      outputs: { push_total: 3, serve_configured: true, serve_enabled: false, record_total: 2, configured_total: 6 }
    };
    expect(directionIdsFromRoomSummary(room)).toEqual(['IN_PUSH', 'IN_PULL', 'OUT_PUSH', 'OUT_PULL', 'RECORD']);
    expect(roomMatchesDirection(room, 'OUT_PULL')).toBe(true);
    expect(roomMatchesDirection(room, 'all')).toBe(true);
  });

  it('keeps a paused OUT_PULL room findable via serve_configured, not serve_enabled', () => {
    const room = { inputs: { kinds: ['IN_PUSH'] }, outputs: { push_total: 0, serve_configured: true, serve_enabled: false, record_total: 0 } };
    expect(directionIdsFromRoomSummary(room)).toEqual(['IN_PUSH', 'OUT_PULL']);
  });

  it('applies the legacy rule: bare rooms read as IN_PUSH only', () => {
    const room = { inputs: { kinds: ['IN_PUSH'], push_credentials: 0, pull_tasks: 0 }, outputs: { configured_total: 0 } };
    expect(directionIdsFromRoomSummary(room)).toEqual(['IN_PUSH']);
  });

  it('projects unknown modes to null instead of guessing a direction', () => {
    expect(directionIdFromOutputMode('WEIRD')).toBeNull();
    expect(directionIdFromOutputMode('')).toBeNull();
    expect(directionIdFromSourceKind('SIDEWAYS')).toBeNull();
  });

  it('exposes label keys and icons for every direction without color', () => {
    for (const id of DIRECTION_IDS) {
      const direction = getDirection(id);
      expect(direction).not.toBeNull();
      expect(direction.labelKey).toMatch(/^streams:directions\./);
      expect(typeof direction.icon).toBe('object');
      expect(direction).not.toHaveProperty('color');
      expect(direction).not.toHaveProperty('tone');
    }
  });
});
