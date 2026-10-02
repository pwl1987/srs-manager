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
vi.mock('../../lib/api', () => ({ api: { post: vi.fn().mockResolvedValue({}), get: vi.fn().mockResolvedValue([]) } }));
vi.mock('flv.js', () => ({ default: { isSupported: () => false } }));
vi.mock('hls.js', () => ({ default: { isSupported: () => false } }));
import { MemoryRouter } from 'react-router-dom';
import WorkspaceControlSurfaceV3, { Drawer } from './WorkspaceControlSurfaceV3';
import WorkspaceInputRackV3, { SourceRow } from './WorkspaceInputRackV3';
import { BuilderDrawer, OutputRow, toggleOutput } from './V3OutputRack';
import { Evidence } from './V3OutputRack';
import OperationsDock, { OperationsResources, acknowledgeIncident } from './OperationsDock';
import SessionCommandBar from './SessionCommandBar';
import {
  filterStreams,
  StreamDiscoveryFilters,
  StreamFilteredEmptyState,
  StreamHeaderActions
} from '../../pages/stream-discovery';
import Streams from '../../pages/Streams';
import { api } from '../../lib/api';
import LiveOperations, { applyLiveOperationsResult, filterLiveRooms, loadLiveOperations, refreshLiveOperations } from '../../pages/LiveOperations';

const t = key => key;
const room = { id: 'room:1', name: '晚间新闻' };

function renderWorkspace(overrides = {}) {
  const outputs = [
    { id: 'push-failed', name: '视频号', mode: 'PUSH', desired_state: 'RUNNING', runtime_state: 'FAILED', control_mode: 'MANAGED', transport: 'rtmp', scene: 'LIVE_PLATFORM_PUSH', media_ref: 'rendition:original' },
    { id: 'serve-live', name: '网宿 CDN', mode: 'SERVE', desired_state: 'RUNNING', runtime_state: 'AVAILABLE', control_mode: 'MANAGED', scene: 'CDN_ORIGIN', endpoints: [{ transport: 'hls', protection: 'external-proxy', advertised: true }] },
    { id: 'recording', name: '本地录像', mode: 'RECORD', desired_state: 'RUNNING', runtime_state: 'RECORDING', control_mode: 'MANAGED', format: 'mp4', asset: { state: 'ACTIVE' }, media_ref: 'rendition:720' }
  ];  const workspace = {
    room,
    session: { title: '晚间新闻直播', lifecycle_state: 'ON_AIR', run_plan_id: 1, preflight_status: 'PASS', outputs: [] },
    sources: [
      { id: 'program', name: '主编码器', role: 'PROGRAM', availability: 'ONLINE', kind: 'IN_PUSH', protocol: 'rtmp' },
      { id: 'standby', name: '备编码器', role: 'STANDBY', availability: 'UNKNOWN', kind: 'IN_PULL', protocol: 'srt', compatibility: { enabled: true } },
      { id: 'candidate', name: '候选编码器', role: 'CANDIDATE', availability: 'ONLINE', kind: 'IN_PULL', protocol: 'srt', compatibility: { enabled: true } },
      { id: 'offline', name: '旧备源', role: 'OFFLINE', availability: 'OFFLINE', kind: 'IN_PULL', protocol: 'rtmp', compatibility: { enabled: false } }
    ],
    program: { source_id: 'program', state: 'LIVE' },
    outputs,
    renditions: [
      { id: 'rendition:original', kind: 'PASSTHROUGH' },
      { id: 'rendition:720', kind: 'TRANSCODE', media_profile_id: 'media-profile:720', runtime_state: 'RUNNING', observed: { online: true } }
    ],
    health: { status: 'DEGRADED' },
    evidence: { workers: { pull: { available: true }, push: { available: false }, transcode: { available: true }, record: { available: true } } },
    capabilities: { runtime: { record: { storage: { low_space: false } } } },
    timeline: [{ type: 'PROGRAM_OBSERVED', occurred_at: 'now' }],
    operations: [{ id: 'op-1', type: 'START_OUTPUT', phase: 'RUNNING', step: 'VERIFY' }]
  };
  const incidentState = { active: [{ id: 'i-1', title: '视频号异常', severity: 'CRITICAL', status: 'OPEN', message: 'connection reset', impact: { output_ids: ['push-failed'], can_still_broadcast: true, suggested_action: '重试' } }], recent: [] };
  return renderToStaticMarkup(
    <MemoryRouter>
      <WorkspaceControlSurfaceV3
        stream={room}
        observed={{ online: true, bitrate: 8100, uptime_seconds: 10, players: { count: 2 } }}
        media={{ video: { codec: 'H.264', width: 1920, height: 1080 }, audio: { codec: 'AAC', sample_rate: 48000, channels: 2 } }}
        v3Workspace={{ ...workspace, ...overrides.workspace }}
        sourcePreview={{ source_id: 'standby', source_name: '备编码器' }}
        outputScenes={[]}
        incidentState={overrides.incidentState || incidentState}
        sourceDrawerContent={<div>sources</div>}
        advancedDrawerContent={<div>advanced</div>}
        onPreviewSource={() => {}}
        onQr={() => {}}
        onChanged={async () => {}}
        t={t}
        readOnlyHarness
        initialDrawer={overrides.initialDrawer}
      />
    </MemoryRouter>
  );
}describe('operator UI semantics', () => {
  it('keeps input, output, session and incident language aligned', () => {
    const html = renderWorkspace();
    expect(html).toContain('没有已验证备用源');
    expect(html).toContain('待确认');
    expect(html).toContain('启动失败 · 可重试');
    expect(html).toContain('正在播出');
    expect(html).toContain('视频号异常');
    expect(renderWorkspace({ initialDrawer: 'sources' })).toContain('输入来源');
    expect(renderWorkspace({ initialDrawer: 'advanced' })).toContain('高级运行控制');
  });

  it('synchronizes a conflicting output operation instead of showing a dead-end error', async () => {
    const apiClient = {
      post: vi.fn().mockRejectedValue({ status: 409, detail: { id: 'operation:record:1', phase: 'VERIFYING' } }),
      get: vi.fn().mockResolvedValue({ id: 'operation:record:1', phase: 'SUCCEEDED' })
    };
    const notify = { success: vi.fn(), error: vi.fn(), warning: vi.fn() };
    const onChanged = vi.fn();
    await toggleOutput({ apiClient, roomId: 'room:1', output: { id: 'output:record:1' }, action: 'stop', onChanged, notify, sleep: async () => {} });
    expect(apiClient.get).toHaveBeenCalledWith('/v3/operations/operation%3Arecord%3A1');
    expect(onChanged).toHaveBeenCalled();
    expect(notify.success).toHaveBeenCalledWith('输出状态已完成，界面已刷新');
  });

  it('covers successful output control and non-conflict errors', async () => {
    const notify = { success: vi.fn(), error: vi.fn(), warning: vi.fn() };
    const onChanged = vi.fn();
    await toggleOutput({
      apiClient: { post: vi.fn().mockResolvedValue({}) },
      roomId: 'room:1', output: { id: 'output:push:1' }, action: 'start', onChanged, notify
    });
    expect(notify.success).toHaveBeenCalledWith('已提交启动操作');
    expect(onChanged).toHaveBeenCalled();

    const failure = new Error('输出不可用');
    failure.status = 503;
    await toggleOutput({
      apiClient: { post: vi.fn().mockRejectedValue(failure) },
      roomId: 'room:1', output: { id: 'output:push:1' }, action: 'start', notify
    });
    expect(notify.error).toHaveBeenCalledWith('输出不可用');
  });

  it('shows failed and still-running operation outcomes', async () => {
    for (const [phase, expected] of [['FAILED', '输出失败'], ['VERIFYING', '输出仍在处理中，请稍后查看状态']]) {
      const notify = { success: vi.fn(), error: vi.fn(), warning: vi.fn() };
      const apiClient = {
        post: vi.fn().mockRejectedValue({ status: 409, detail: { id: 'operation:record:1', phase: 'VERIFYING' } }),
        get: vi.fn().mockResolvedValue({ id: 'operation:record:1', phase, error: phase === 'FAILED' ? expected : null })
      };
      await toggleOutput({ apiClient, roomId: 'room:1', output: { id: 'output:record:1' }, action: 'stop', notify, sleep: async () => {} });
      if (phase === 'FAILED') expect(notify.error).toHaveBeenCalledWith(expected);
      else expect(notify.warning).toHaveBeenCalledWith(expected);
    }
  });

  it('reports operation polling failures', async () => {
    const notify = { success: vi.fn(), error: vi.fn(), warning: vi.fn() };
    const pollError = new Error('状态读取失败');
    const apiClient = {
      post: vi.fn().mockRejectedValue({ status: 409, detail: { id: 'operation:record:1', phase: 'VERIFYING' } }),
      get: vi.fn().mockRejectedValue(pollError)
    };
    await toggleOutput({ apiClient, roomId: 'room:1', output: { id: 'output:record:1' }, action: 'stop', notify, sleep: async () => {} });
    expect(notify.error).toHaveBeenCalledWith('状态读取失败');
  });

  it('renders local and remote evidence without inventing remote health', () => {
    const html = renderToStaticMarkup(<Evidence output={{ evidence: { local: { state: 'RUNNING', source: 'worker' }, remote: { state: 'UNKNOWN', source: null } } }} />);
    expect(html).toContain('本地证据');
    expect(html).toContain('远端证据');
    expect(html).toContain('尚未接入远端验证');
  });

  it('renders compact session states and explicit next actions', () => {
    const sessionOutputs = { session: { title: '必需输出', lifecycle_state: 'ON_AIR', preflight_status: 'BLOCKED', outputs: [
      { importance: 'REQUIRED', output_ref: 'push-1' },
      { importance: 'REQUIRED', output_ref: 'serve-1' },
      { importance: 'REQUIRED', output_ref: 'record-1' },
      { importance: 'REQUIRED', output_ref: 'missing-1' }
    ] }, outputs: [
      { id: 'push-1', mode: 'PUSH', runtime_state: 'RUNNING' },
      { id: 'serve-1', mode: 'SERVE', runtime_state: 'AVAILABLE' },
      { id: 'record-1', mode: 'RECORD', runtime_state: 'RECORDING' }
    ], program: {} };
    const withOutputs = renderToStaticMarkup(<SessionCommandBar roomId="room:1" workspace={sessionOutputs} onChanged={async () => {}} compact readOnly />);
    expect(withOutputs).toContain('3/4');
    expect(withOutputs).toContain('被阻断');

    const warningState = renderToStaticMarkup(<SessionCommandBar roomId="room:1" workspace={{ session: { title: '预检提示', lifecycle_state: 'READY', preflight_status: 'READY_WITH_WARNING', outputs: [] }, outputs: [], program: {} }} onChanged={async () => {}} compact readOnly />);
    expect(warningState).toContain('有警告');
    for (const state of ['PREP', 'READY', 'CLOSING']) {
      const html = renderToStaticMarkup(<SessionCommandBar roomId="room:1" workspace={{ session: { title: '测试场', lifecycle_state: state, preflight_status: 'WARNING', outputs: [] }, outputs: [], program: {} }} onChanged={async () => {}} compact readOnly />);
      expect(html).toContain(state === 'PREP' ? '准备中' : state === 'READY' ? '待开播' : '收播中');
    }
    const quickPlan = renderToStaticMarkup(<SessionCommandBar roomId="room:1" workspace={{ outputs: [{ id: 'push-1', name: '视频号', mode: 'PUSH' }], sources: [{ id: 'program', name: '主编码器', kind: 'IN_PUSH', configured: true }, { id: 'unattributed', name: '未归属推流', kind: 'IN_PUSH', configured: false }], program: { source_id: 'program' } }} onChanged={async () => {}} compact readOnly initialShowQuickPlan />);
    expect(quickPlan).toContain('方案会记录指定节目源和所选输出');
    expect(quickPlan).toContain('选择节目源');
    expect(quickPlan).toContain('主编码器');
    expect(quickPlan).not.toContain('未归属推流');
    const empty = renderToStaticMarkup(<SessionCommandBar roomId="room:1" workspace={{ outputs: [], program: {} }} onChanged={async () => {}} compact readOnly />);
    expect(empty).toContain('创建本场直播');
    expect(empty).toContain('还没有开播方案');
    expect(renderToStaticMarkup(<SessionCommandBar roomId="room:1" workspace={{ session: { title: '结束测试', lifecycle_state: 'ON_AIR', preflight_status: 'PASS', outputs: [] }, outputs: [], program: {} }} onChanged={async () => {}} compact readOnly />)).toContain('结束本场直播');
    expect(renderToStaticMarkup(<SessionCommandBar roomId="room:1" workspace={{ session: { title: '结束测试', lifecycle_state: 'ON_AIR', preflight_status: 'PASS', outputs: [] }, outputs: [], program: {} }} onChanged={async () => {}} compact readOnly initialConfirmClose />)).toContain('停止本场网络输出');
    expect(renderToStaticMarkup(<SessionCommandBar roomId="room:1" workspace={{ session: { title: '结束测试', lifecycle_state: 'ENDED', preflight_status: 'PASS', outputs: [] }, outputs: [], program: {} }} onChanged={async () => {}} compact readOnly />)).toContain('查看状态');
    expect(renderWorkspace({ workspace: { session: null } })).toContain('创建本场直播');
  });
  it('covers resources and discoverability helpers', async () => {
    const resources = renderToStaticMarkup(<OperationsResources workers={{ pull: { available: true, instance_id: 'pull-1' } }} workspace={{ capabilities: { runtime: { record: { storage: { low_space: true } } } } }} />);
    expect(resources).toContain('拉流 工作进程');
    expect(resources).toContain('空间不足');
    const dock = renderToStaticMarkup(<OperationsDock roomId="room:1" workspace={{ evidence: { workers: { pull: { available: true } } }, capabilities: { runtime: { record: { storage: { low_space: true } } } } }} incidentState={{ active: [], recent: [] }} onChanged={async () => {}} initialTab="resources" />);
    expect(dock).toContain('拉流 工作进程');
    await acknowledgeIncident('room:1', { id: 'i-1' }, async () => {});

    api.get.mockImplementation(path => path === '/v3/rooms' ? Promise.resolve({ rooms: [] }) : Promise.reject(new Error('not available')));
    const loaded = await loadLiveOperations();
    expect(loaded.rooms).toEqual([]);
    expect(loaded.external).toEqual([]);
    expect(loaded.streams).toEqual([]);
    const setters = { setRooms: vi.fn(), setExternal: vi.fn(), setStreams: vi.fn() };
    applyLiveOperationsResult({ rooms: ['room'], external: ['external'], streams: ['stream'] }, setters);
    expect(setters.setRooms).toHaveBeenCalledWith(['room']);
    expect(setters.setExternal).toHaveBeenCalledWith(['external']);
    expect(setters.setStreams).toHaveBeenCalledWith(['stream']);
    const refreshSetters = { setLoading: vi.fn(), setRooms: vi.fn(), setExternal: vi.fn(), setStreams: vi.fn(), setError: vi.fn() };
    await refreshLiveOperations({ ...refreshSetters, silent: false });
    expect(refreshSetters.setLoading).toHaveBeenCalledWith(false);
    api.get.mockRejectedValue(new Error('读取失败'));
    const failingSetters = { setLoading: vi.fn(), setRooms: vi.fn(), setExternal: vi.fn(), setStreams: vi.fn(), setError: vi.fn() };
    await refreshLiveOperations({ ...failingSetters, silent: false });
    expect(failingSetters.setError).toHaveBeenCalledWith(expect.any(Error));
    expect(failingSetters.setLoading).toHaveBeenCalledWith(false);
    api.get.mockResolvedValue([]);

    const streams = [
      { name: '任意社会学', protocol: 'srt', status: 'online' },
      { name: '文艺工程学', protocol: 'rtmp', status: 'offline' }
    ];
    expect(filterStreams(streams, '社会学', 'all')).toHaveLength(1);
    expect(filterStreams(streams, 'rtmp', 'offline')).toHaveLength(1);
    expect(filterStreams(streams, '不存在', 'all')).toHaveLength(0);

    const rooms = [
      { room: { id: 'room:1', legacy_stream_id: 1, name: '新闻直播间' }, session: { lifecycle_state: 'OFF_AIR' }, program: { state: 'IDLE' }, health: { status: 'HEALTHY' }, active_incidents: 0, inputs: { kinds: ['IN_PUSH'], push_credentials: 0, pull_tasks: 0 }, outputs: { required_total: 0, required_healthy: 0, configured_total: 0 } },
      { room: { id: 'room:2', legacy_stream_id: 2, name: '晚间节目' }, session: { lifecycle_state: 'ON_AIR' }, program: { state: 'LIVE' }, health: { status: 'DEGRADED' }, active_incidents: 1, inputs: { kinds: ['IN_PUSH'], push_credentials: 2, pull_tasks: 0 }, outputs: { required_total: 2, required_healthy: 1, configured_total: 2 } },
      { room: { id: 'room:3', legacy_stream_id: 3, name: '文艺直播' }, session: { lifecycle_state: 'ON_AIR' }, program: { state: 'LIVE' }, health: { status: 'NORMAL' }, active_incidents: 0, inputs: { kinds: ['IN_PUSH'], push_credentials: 1, pull_tasks: 0 }, outputs: { required_total: 1, required_healthy: 1, push_total: 1, serve_configured: false, record_total: 0, configured_total: 1 } }
    ];
    const roomStreams = [
      { id: 1, name: '任意社会学', protocol: 'srt', status: 'offline' },
      { id: 2, name: '文艺工程学', protocol: 'rtmp', status: 'online' },
      { id: 3, name: '文艺直播流', protocol: 'rtmp', status: 'online' }
    ];
    expect(filterLiveRooms(rooms, roomStreams, '社会学')).toHaveLength(1);
    expect(filterLiveRooms(rooms, roomStreams, 'rtmp', 'running')).toHaveLength(1);
    expect(filterLiveRooms(rooms, roomStreams, '', 'attention')).toHaveLength(1);
    expect(filterLiveRooms(rooms, roomStreams, '', 'idle')).toHaveLength(1);
    expect(filterLiveRooms(rooms, roomStreams, '', 'all', 'OUT_PUSH')).toHaveLength(1);

    const input = renderToStaticMarkup(<WorkspaceInputRackV3 workspace={{ program: { source_id: 'push' }, sources: [{ id: 'push', name: '外部推流', role: 'PROGRAM', kind: 'IN_PUSH', protocol: 'rtmp', availability: 'ONLINE' }, { id: 'pull', name: '合作方备用源', role: 'STANDBY', kind: 'IN_PULL', protocol: 'srt', availability: 'READY', compatibility: { enabled: true } }] }} previewingSourceId={null} onPreview={() => {}} onManage={() => {}} />);
    const output = renderToStaticMarkup(<OutputRow output={{ id: 'serve-1', name: '合作方拉取', mode: 'SERVE', runtime_state: 'AVAILABLE', desired_state: 'RUNNING', control_mode: 'MANAGED', transport: 'hls', endpoints: [{ transport: 'hls', advertised: true }] }} renditionMap={new Map()} busy={false} onToggle={() => {}} />);
    const processingOutput = renderToStaticMarkup(<OutputRow output={{ id: 'record-1', name: '本地录像', mode: 'RECORD', runtime_state: 'FINALIZING', desired_state: 'STOPPED', control_mode: 'MANAGED', format: 'mp4' }} renditionMap={new Map()} busy={false} onToggle={() => {}} />);
    expect(input).toContain('第三方推给我们');
    expect(input).toContain('我们主动拉第三方');
    expect(output).toContain('第三方拉我们的输出');
    expect(processingOutput).toContain('处理中');
    expect(processingOutput).toContain('disabled');
    expect(renderToStaticMarkup(<SourceRow source={{ id: 'direct', name: '直接输入', role: 'PROGRAM', kind: 'IN_PUSH', protocol: 'rtmp', availability: 'ONLINE' }} previewing={false} onPreview={() => {}} />)).toContain('第三方推给我们');

    const actions = renderToStaticMarkup(<StreamHeaderActions search="" onSearch={() => {}} onCreate={() => {}} createLabel="创建" />);
    const filters = renderToStaticMarkup(<StreamDiscoveryFilters statusFilter="online" onStatusFilter={() => {}} resultCount={1} totalCount={2} hasFilter />);
    const empty = renderToStaticMarkup(<StreamFilteredEmptyState hasFilter onClear={() => {}} onCreate={() => {}} t={t} />);
    expect(actions).toContain('搜索名称、协议或状态');
    expect(filters).toContain('找到 1 / 2 路');
    expect(empty).toContain('没有找到匹配的直播流');

    const page = renderToStaticMarkup(<MemoryRouter><Streams /></MemoryRouter>);
    expect(page).toContain('正在直播');

    const liveRooms = [
      { room: { id: 'room:1', legacy_stream_id: 1, name: '新闻直播间' }, session: null, program: { state: 'IDLE' }, health: { status: 'HEALTHY' }, inputs: { kinds: ['IN_PUSH'], push_credentials: 0, pull_tasks: 0 }, outputs: { required_total: 0, required_healthy: 0, configured_total: 0 }, active_incidents: 0 },
      { room: { id: 'room:2', legacy_stream_id: 2, name: '晚间节目' }, session: { lifecycle_state: 'ON_AIR', title: '晚间新闻' }, program: { state: 'LIVE', bitrate: 8100, viewers: 8, uptime_seconds: 120 }, health: { status: 'DEGRADED' }, inputs: { kinds: ['IN_PUSH', 'IN_PULL'], push_credentials: 1, pull_tasks: 1 }, outputs: { required_total: 2, required_healthy: 1, record_state: 'RECORDING', push_total: 1, serve_configured: true, record_total: 1, configured_total: 3 }, active_incidents: 1 }
    ];
    const livePage = renderToStaticMarkup(<MemoryRouter><LiveOperations initialRooms={liveRooms} initialStreams={roomStreams} initialExternal={[{ name: '未登记推流' }]} initialLoading={false} initialError={new Error('测试错误')} initialOpen initialForm={{ name: '任意社会学', protocol: 'srt' }} /></MemoryRouter>);
    expect(livePage).toContain('直播资源');
    expect(livePage).toContain('搜索直播间、直播流、方向或状态');
    expect(livePage).toContain('登记外部流');
    expect(livePage).toContain('需关注');
    expect(livePage).toContain('新建直播间向导');
    expect(livePage).toContain('任意社会学');
    expect(livePage).toContain('我们推给第三方');
    expect(livePage).toContain('本地输出');
    expect(livePage).toContain('进入工作台');
    expect(livePage).toContain('刷新');

    const highlighted = renderToStaticMarkup(<MemoryRouter><LiveOperations initialRooms={liveRooms} initialStreams={roomStreams} initialLoading={false} initialSearch="社会学" /></MemoryRouter>);
    expect(highlighted).toContain('<mark');
    const emptyFiltered = renderToStaticMarkup(<MemoryRouter><LiveOperations initialRooms={liveRooms} initialStreams={roomStreams} initialLoading={false} initialSearch="不存在的名称" /></MemoryRouter>);
    expect(emptyFiltered).toContain('没有找到匹配的直播资源');
    expect(emptyFiltered).toContain('清除筛选');
    const bare = renderToStaticMarkup(<MemoryRouter><LiveOperations initialRooms={[]} initialStreams={[]} initialLoading={false} /></MemoryRouter>);
    expect(bare).toContain('尚未创建直播间');

    const withSelection = renderToStaticMarkup(<MemoryRouter><LiveOperations initialRooms={liveRooms} initialStreams={roomStreams} initialLoading={false} initialSelectedRoomId="room:2" /></MemoryRouter>);
    expect(withSelection).toContain('值守面板');
    expect(withSelection).toContain('进入完整工作台');
    const loadingPage = renderToStaticMarkup(<MemoryRouter><LiveOperations initialRooms={[]} initialStreams={[]} initialLoading /></MemoryRouter>);
    expect(loadingPage).toContain('animate-pulse');

    const builderScenes = [{ id: 'LIVE_PLATFORM_PUSH', mode: 'PUSH', default_transport: 'rtmp', transports: ['rtmp'] }, { id: 'CDN_ORIGIN', mode: 'SERVE', default_transport: 'hls', transports: ['hls'] }];
    const sceneBuilder = renderToStaticMarkup(<BuilderDrawer roomId="room:1" scenes={builderScenes} capabilities={{ protections: { 'PUSH:rtmp': ['none'] } }} onClose={() => {}} onCreated={() => {}} />);
    expect(sceneBuilder).toContain('我要做什么');
    const builder = renderToStaticMarkup(<BuilderDrawer roomId="room:1" scenes={builderScenes} capabilities={{ protections: { 'PUSH:rtmp': ['none'] } }} initialBuilderMode="pro" initialCompatibility={{ valid: true, message: '组合可执行' }} onClose={() => {}} onCreated={() => {}} />);
    expect(builder).toContain('输出配置');
    expect(builder).toContain('我们推给第三方');
    expect(builder).toContain('节目原始码流');
    expect(builder).toContain('共享媒体规格');

    const drawer = renderToStaticMarkup(<Drawer eyebrow="输入与节目源" title="输入配置" onClose={() => {}}>内容</Drawer>);
    expect(drawer).toContain('输入与节目源');
  });
});