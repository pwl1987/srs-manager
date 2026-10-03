import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  globalThis.localStorage = { getItem: () => null, setItem: () => {} };
  globalThis.document = { documentElement: { lang: '' } };
  globalThis.self = globalThis;
  Object.defineProperty(globalThis, 'navigator', { value: { language: 'zh-CN' }, configurable: true });
});
vi.mock('sonner', () => ({ toast: { success: () => {}, error: () => {}, warning: () => {} } }));
vi.mock('../../lib/api', () => ({ api: { post: vi.fn().mockResolvedValue({}), get: vi.fn().mockResolvedValue({}) } }));
vi.mock('flv.js', () => ({ default: { isSupported: () => false } }));
vi.mock('hls.js', () => ({ default: { isSupported: () => false } }));

import { MemoryRouter } from 'react-router-dom';
import '../../i18n';
import i18n from '../../i18n';
import RoomCommandPanel, { CloseSessionConfirm } from './RoomCommandPanel';
import Stepper from '../ui/Stepper';
import { createRoomWorkspacePoller, startRoomWorkspacePolling } from './room-workspace-poll';

const t = i18n.getFixedT(null, 'streams');

const room = (overrides = {}) => ({
  room: { id: 'room:7', legacy_stream_id: 7, name: '任意社会学' },
  session: null,
  program: { state: 'NO_PROGRAM' },
  inputs: { kinds: ['IN_PUSH'], push_credentials: 1, pull_tasks: 0 },
  outputs: { required_total: 1, required_healthy: 1, configured_total: 1 },
  health: { status: 'NORMAL' },
  active_incidents: 0,
  critical_incidents: 0,
  ...overrides
});

describe('room command panel', () => {
  it('renders confirm-state facts, preview and lifecycle actions for an on-air room', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <RoomCommandPanel
          room={room({ session: { lifecycle_state: 'ON_AIR', title: '晚间新闻' }, program: { state: 'LIVE', bitrate: 8100, uptime_seconds: 300, viewers: 8 } })}
          initialWorkspace={{ program: { state: 'LIVE', bitrate: 8100, uptime_seconds: 300, viewers: 8 }, session: { lifecycle_state: 'ON_AIR', title: '晚间新闻' }, observed: { online: true } }}
        />
      </MemoryRouter>
    );
    expect(html).toContain('值守面板');
    expect(html).toContain('正在播出');
    expect(html).toContain('结束本场直播');
    expect(html).toContain('进入完整工作台');
    expect(html).toContain('必需输出');
    // The close trigger alone must NOT run closeSession: the confirmation
    // dialog starts closed and renders nothing until the user opens it.
    expect(html).not.toContain('确认收播');
    expect(html).not.toContain('等待录像整理完成');
  });

  it('gates 结束本场直播 behind the shared close confirmation copy', () => {
    const closed = renderToStaticMarkup(<CloseSessionConfirm open={false} t={t} />);
    expect(closed).toBe('');
    const open = renderToStaticMarkup(<CloseSessionConfirm open t={t} />);
    // Same copy as the full workspace's SessionCommandBar close dialog.
    expect(open).toContain('结束本场直播');
    expect(open).toContain('确认收播');
    expect(open).toContain('等待录像整理完成');
  });

  it('keeps rooms without a session on the entry path to the full workspace', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <RoomCommandPanel room={room()} initialWorkspace={{ program: { state: 'NO_PROGRAM' } }} />
      </MemoryRouter>
    );
    expect(html).toContain('本场直播尚未创建');
    expect(html).toContain('进入完整工作台');
    expect(html).not.toContain('结束本场直播');
  });

  it('marks ended broadcasts explicitly', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <RoomCommandPanel
          room={room({ session: { lifecycle_state: 'ENDED' } })}
          initialWorkspace={{ program: { state: 'NO_PROGRAM' }, session: { lifecycle_state: 'ENDED' } }}
        />
      </MemoryRouter>
    );
    expect(html).toContain('本场已结束');
  });

  it('surfaces workspace read failures with the fallback message', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <RoomCommandPanel room={room()} initialError={new Error('')} />
      </MemoryRouter>
    );
    expect(html).toContain('无法读取房间状态');
  });

  it('renders stepper done/active/blocked states without jumping ahead', () => {
    const steps = [
      { key: 'a', label: 'A' },
      { key: 'b', label: 'B' },
      { key: 'c', label: 'C' }
    ];
    const html = renderToStaticMarkup(<Stepper steps={steps} current={1} maxReached={1} t={key => key} />);
    expect(html).toContain('A');
    expect(html).toContain('disabled');
    const revisited = renderToStaticMarkup(<Stepper steps={steps} current={0} maxReached={2} t={key => key} />);
    expect(revisited).toContain('B');
  });
});

function manualTimers() {
  const calls = [];
  const tasks = new Map();
  let seq = 0;
  return {
    schedule(fn, ms) { const id = ++seq; calls.push(ms); tasks.set(id, fn); return id; },
    cancel: id => tasks.delete(id),
    flush() { const pending = [...tasks.values()]; tasks.clear(); pending.forEach(fn => fn()); },
    pendingCount: () => tasks.size,
    delays: () => calls
  };
}

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

describe('room workspace poller protections', () => {
  it('discards stale responses once stopped (room switched or panel closed)', async () => {
    let resolveFetch;
    const fetchWorkspace = () => new Promise(resolve => { resolveFetch = resolve; });
    const onWorkspace = vi.fn();
    const timers = manualTimers();
    const poller = createRoomWorkspacePoller({ fetchWorkspace, onWorkspace, schedule: timers.schedule, cancel: timers.cancel });
    poller.start();
    poller.stop();
    resolveFetch({ program: { state: 'LIVE' } });
    await settle(); await settle();
    expect(onWorkspace).not.toHaveBeenCalled();
    expect(timers.pendingCount()).toBe(0);
  });

  it('routes fetch failures to onError and keeps polling', async () => {
    let failFirst = true;
    const onWorkspace = vi.fn();
    const onError = vi.fn();
    const timers = manualTimers();
    const poller = createRoomWorkspacePoller({
      fetchWorkspace: async () => {
        if (failFirst) { failFirst = false; throw new Error('workspace 500'); }
        return { program: { state: 'LIVE' } };
      },
      onWorkspace,
      onError,
      schedule: timers.schedule,
      cancel: timers.cancel
    });
    poller.start();
    await settle(); await settle();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'workspace 500' }));
    expect(onWorkspace).not.toHaveBeenCalled();
    timers.flush();
    await settle(); await settle();
    expect(onWorkspace).toHaveBeenCalledTimes(1);
    poller.stop();
  });

  it('polls on the foreground interval and drops to the background interval while hidden', async () => {
    const onWorkspace = vi.fn();
    const timers = manualTimers();
    let hidden = false;
    const poller = createRoomWorkspacePoller({
      fetchWorkspace: async () => ({ program: { state: 'LIVE' } }),
      onWorkspace,
      intervalMs: 2000,
      backgroundIntervalMs: 20000,
      isHidden: () => hidden,
      schedule: timers.schedule,
      cancel: timers.cancel
    });
    poller.start();
    await settle();
    expect(onWorkspace).toHaveBeenCalledTimes(1);
    expect(timers.delays()).toEqual([2000]);

    timers.flush();
    await settle();
    expect(onWorkspace).toHaveBeenCalledTimes(2);

    hidden = true;
    timers.flush();
    await settle();
    expect(onWorkspace).toHaveBeenCalledTimes(3);
    expect(timers.delays()).toEqual([2000, 2000, 20000]);
    poller.stop();
  });

  it('refresh polls immediately and start is idempotent while a fetch is in flight', async () => {
    let resolveFetch;
    const fetchWorkspace = vi.fn(() => new Promise(resolve => { resolveFetch = resolve; }));
    const onWorkspace = vi.fn();
    const timers = manualTimers();
    const poller = createRoomWorkspacePoller({ fetchWorkspace, onWorkspace, schedule: timers.schedule, cancel: timers.cancel });
    poller.start();
    poller.start(); // in-flight guard: no second concurrent fetch
    expect(fetchWorkspace).toHaveBeenCalledTimes(1);
    poller.refresh(); // cancels nothing yet (no timer), guarded by inFlight
    expect(fetchWorkspace).toHaveBeenCalledTimes(1);
    resolveFetch({});
    await settle();
    poller.refresh(); // now immediate re-poll
    expect(fetchWorkspace).toHaveBeenCalledTimes(2);
    resolveFetch({});
    await settle();
    expect(onWorkspace).toHaveBeenCalledTimes(2);
    poller.stop();
    expect(poller.isStopped()).toBe(true);
  });

  it('wires visibility resume and disposes listener + poller', async () => {
    const listeners = new Map();
    const doc = {
      hidden: false,
      addEventListener: (event, fn) => listeners.set(event, fn),
      removeEventListener: event => listeners.delete(event)
    };
    let fetches = 0;
    const wiring = startRoomWorkspacePolling({
      roomId: 'room:1',
      fetchWorkspace: async () => { fetches += 1; return {}; },
      onWorkspace: () => {},
      onError: () => {},
      doc
    });
    await settle();
    expect(fetches).toBe(1);
    expect(listeners.has('visibilitychange')).toBe(true);
    listeners.get('visibilitychange')();
    await settle();
    expect(fetches).toBe(2);
    wiring.dispose();
    expect(listeners.has('visibilitychange')).toBe(false);
    expect(wiring.poller.isStopped()).toBe(true);
  });
});
