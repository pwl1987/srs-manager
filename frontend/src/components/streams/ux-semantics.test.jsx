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
import { BuilderDrawer, OutputRow } from './V3OutputRack';
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

  it('renders local and remote evidence without inventing remote health', () => {
    const html = renderToStaticMarkup(<Evidence output={{ evidence: { local: { state: 'RUNNING', source: 'worker' }, remote: { state: 'UNKNOWN', source: null } } }} />);
    expect(html).toContain('本地证据');
    expect(html).toContain('远端证据');
    expect(html).toContain('尚未接入远端验证');
  });

  it('renders compact session states and explicit next actions', () => {
    for (const state of ['PREP', 'READY', 'CLOSING']) {
      const html = renderToStaticMarkup(<SessionCommandBar roomId="room:1" workspace={{ session: { title: '测试场', lifecycle_state: state, preflight_status: 'WARNING', outputs: [] }, outputs: [], program: {} }} onChanged={async () => {}} compact readOnly />);
      expect(html).toContain(state === 'PREP' ? '准备中' : state === 'READY' ? '待开播' : '收播中');
    }
    const quickPlan = renderToStaticMarkup(<SessionCommandBar roomId="room:1" workspace={{ outputs: [{ id: 'push-1', name: '视频号', mode: 'PUSH' }], program: { source_id: 'program' } }} onChanged={async () => {}} compact readOnly initialShowQuickPlan />);
    expect(quickPlan).toContain('方案会记录当前节目源和所选输出');
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
    api.get.mockResolvedValue([]);

    const streams = [
      { name: '任意社会学', protocol: 'srt', status: 'online' },
      { name: '文艺工程学', protocol: 'rtmp', status: 'offline' }
    ];
    expect(filterStreams(streams, '社会学', 'all')).toHaveLength(1);
    expect(filterStreams(streams, 'rtmp', 'offline')).toHaveLength(1);
    expect(filterStreams(streams, '不存在', 'all')).toHaveLength(0);

    const rooms = [
      { room: { id: 'room:1', legacy_stream_id: 1, name: '新闻直播间' }, session: { lifecycle_state: 'OFF_AIR' }, program: { state: 'IDLE' }, health: { status: 'HEALTHY' }, active_incidents: 0 },
      { room: { id: 'room:2', legacy_stream_id: 2, name: '晚间节目' }, session: { lifecycle_state: 'ON_AIR' }, program: { state: 'LIVE' }, health: { status: 'DEGRADED' }, active_incidents: 1 }
    ];
    const roomStreams = [
      { id: 1, name: '任意社会学', protocol: 'srt', status: 'offline' },
      { id: 2, name: '文艺工程学', protocol: 'rtmp', status: 'online' }
    ];
    expect(filterLiveRooms(rooms, roomStreams, '社会学')).toHaveLength(1);
    expect(filterLiveRooms(rooms, roomStreams, 'rtmp', 'on_air')).toHaveLength(1);
    expect(filterLiveRooms(rooms, roomStreams, '', 'attention')).toHaveLength(1);
    expect(filterLiveRooms(rooms, roomStreams, '', 'idle')).toHaveLength(1);

    const input = renderToStaticMarkup(<WorkspaceInputRackV3 workspace={{ program: { source_id: 'push' }, sources: [{ id: 'push', name: '外部推流', role: 'PROGRAM', kind: 'IN_PUSH', protocol: 'rtmp', availability: 'ONLINE' }, { id: 'pull', name: '合作方备用源', role: 'STANDBY', kind: 'IN_PULL', protocol: 'srt', availability: 'READY', compatibility: { enabled: true } }] }} previewingSourceId={null} onPreview={() => {}} onManage={() => {}} />);
    const output = renderToStaticMarkup(<OutputRow output={{ id: 'serve-1', name: '合作方拉取', mode: 'SERVE', runtime_state: 'AVAILABLE', desired_state: 'RUNNING', control_mode: 'MANAGED', transport: 'hls', endpoints: [{ transport: 'hls', advertised: true }] }} renditionMap={new Map()} busy={false} onToggle={() => {}} />);
    expect(input).toContain('第三方推送给本系统');
    expect(input).toContain('本系统主动拉取');
    expect(output).toContain('提供地址给第三方拉取');
    expect(renderToStaticMarkup(<SourceRow source={{ id: 'direct', name: '直接输入', role: 'PROGRAM', kind: 'IN_PUSH', protocol: 'rtmp', availability: 'ONLINE' }} previewing={false} onPreview={() => {}} />)).toContain('第三方推送给本系统');

    const actions = renderToStaticMarkup(<StreamHeaderActions search="" onSearch={() => {}} onCreate={() => {}} createLabel="创建" />);
    const filters = renderToStaticMarkup(<StreamDiscoveryFilters statusFilter="online" onStatusFilter={() => {}} resultCount={1} totalCount={2} hasFilter />);
    const empty = renderToStaticMarkup(<StreamFilteredEmptyState hasFilter onClear={() => {}} onCreate={() => {}} t={t} />);
    expect(actions).toContain('搜索名称、协议或状态');
    expect(filters).toContain('找到 1 / 2 路');
    expect(empty).toContain('没有找到匹配的直播流');

    const page = renderToStaticMarkup(<MemoryRouter><Streams /></MemoryRouter>);
    expect(page).toContain('正在直播');

    const liveRooms = [
      { room: { id: 'room:1', legacy_stream_id: 1, name: '新闻直播间' }, session: null, program: { state: 'IDLE' }, health: { status: 'HEALTHY' }, outputs: {}, active_incidents: 0 },
      { room: { id: 'room:2', legacy_stream_id: 2, name: '晚间节目' }, session: { lifecycle_state: 'ON_AIR', title: '晚间新闻' }, program: { state: 'LIVE', bitrate: 8100, viewers: 8, uptime_seconds: 120 }, health: { status: 'DEGRADED' }, outputs: { required_total: 2, required_healthy: 1, record_state: 'RECORDING' }, active_incidents: 1 }
    ];
    const livePage = renderToStaticMarkup(<MemoryRouter><LiveOperations initialRooms={liveRooms} initialStreams={roomStreams} initialExternal={[{ name: '未登记推流' }]} initialLoading={false} initialError={new Error('测试错误')} initialOpen initialForm={{ name: '任意社会学', protocol: 'srt' }} /></MemoryRouter>);
    expect(livePage).toContain('直播资源');
    expect(livePage).toContain('搜索直播间、直播流、协议或状态');
    expect(livePage).toContain('登记外部流');
    expect(livePage).toContain('需要关注');
    expect(livePage).toContain('创建并继续配置');
    expect(livePage).toContain('任意社会学');

    const builderScenes = [{ id: 'LIVE_PLATFORM_PUSH', mode: 'PUSH', default_transport: 'rtmp', transports: ['rtmp'] }, { id: 'CDN_ORIGIN', mode: 'SERVE', default_transport: 'hls', transports: ['hls'] }];
    const sceneBuilder = renderToStaticMarkup(<BuilderDrawer roomId="room:1" scenes={builderScenes} capabilities={{ protections: { 'PUSH:rtmp': ['none'] } }} onClose={() => {}} onCreated={() => {}} />);
    expect(sceneBuilder).toContain('我要做什么');
    const builder = renderToStaticMarkup(<BuilderDrawer roomId="room:1" scenes={builderScenes} capabilities={{ protections: { 'PUSH:rtmp': ['none'] } }} initialBuilderMode="pro" initialCompatibility={{ valid: true, message: '组合可执行' }} onClose={() => {}} onCreated={() => {}} />);
    expect(builder).toContain('输出配置');
    expect(builder).toContain('主动推送给第三方');
    expect(builder).toContain('节目原始码流');
    expect(builder).toContain('共享媒体规格');

    const drawer = renderToStaticMarkup(<Drawer eyebrow="输入与节目源" title="输入配置" onClose={() => {}}>内容</Drawer>);
    expect(drawer).toContain('输入与节目源');
  });
});