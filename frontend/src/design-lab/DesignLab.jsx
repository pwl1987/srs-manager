import React, { useMemo, useState } from 'react';
import { Link, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import {
  Activity, AlertTriangle, Archive, ArrowLeft, ArrowRight, Bell, Boxes, ChevronRight,
  CircleDot, Cloud, Copy, Database, FileKey2, Gauge, Globe2, HardDrive, KeyRound,
  Layers3, Menu, Network, Plus, Radio, Search, Server, Settings, ShieldCheck,
  SlidersHorizontal, SquareActivity, TimerReset, Video, X, Zap,
} from 'lucide-react';
import { incidents, outputs, profiles, rooms, runPlans, sources } from './mock';

const panel = 'rounded-xl border border-white/[0.07] bg-[#191d22] shadow-[inset_0_1px_0_rgba(255,255,255,.025)]';
const panelSoft = 'rounded-lg border border-white/[0.06] bg-[#15191e]';
const label = 'text-[10px] font-semibold uppercase tracking-[.14em] text-[#737d89]';
const subtle = 'text-[#8c96a3]';
const button = 'inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-white/[0.09] bg-white/[0.025] px-3 text-xs font-medium text-[#c9d0d8] hover:bg-white/[0.06]';
const primaryButton = 'inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-[#2f78ff] px-3 text-xs font-semibold text-white hover:bg-[#3f84ff]';

function Dot({ tone = 'muted' }) {
  const tones = { healthy: 'bg-[#56c98f]', warning: 'bg-[#e2ac59]', danger: 'bg-[#e46b6b]', rec: 'bg-[#ec5d65]', muted: 'bg-[#69727e]', blue: 'bg-[#5b9aff]' };
  return <span className={`inline-block h-2 w-2 rounded-full ${tones[tone] || tones.muted}`} />;
}

function Status({ children, tone = 'muted' }) {
  const tones = {
    healthy: 'border-[#56c98f]/20 bg-[#56c98f]/8 text-[#75d9a7]',
    warning: 'border-[#e2ac59]/20 bg-[#e2ac59]/8 text-[#efbd6c]',
    danger: 'border-[#e46b6b]/20 bg-[#e46b6b]/8 text-[#f08484]',
    blue: 'border-[#5b9aff]/20 bg-[#5b9aff]/8 text-[#77adff]',
    muted: 'border-white/[0.08] bg-white/[0.025] text-[#99a3ae]',
  };
  return <span className={`inline-flex h-6 items-center gap-1.5 rounded-md border px-2 text-[10px] font-semibold tracking-[.04em] ${tones[tone]}`}>{children}</span>;
}

function PageTitle({ eyebrow, title, description, action }) {
  return <div className="mb-5 flex items-end justify-between gap-4">
    <div><div className={label}>{eyebrow}</div><h1 className="mt-1 text-[22px] font-semibold tracking-[-.02em] text-[#eef1f4]">{title}</h1><p className="mt-1 max-w-3xl text-xs leading-5 text-[#7f8995]">{description}</p></div>
    {action}
  </div>;
}
const navGroups = [
  { title: '运行', items: [
    ['rooms', '直播间', Radio], ['incidents', '告警中心', Bell],
  ] },
  { title: '资源', items: [
    ['profiles', '媒体规格', Layers3], ['run-plans', '开播方案', Boxes],
  ] },
  { title: '集成', items: [
    ['integrations', '平台与 CDN', Cloud], ['dns', 'DNS', Globe2], ['credentials', '凭据与访问控制', KeyRound],
  ] },
  { title: '系统', items: [
    ['system', '节点与运行环境', Server], ['settings', '系统设置', Settings], ['releases', '版本与发布', Archive],
  ] },
];

function DesignLabShell() {
  const location = useLocation();
  const workspace = /\/design-lab\/rooms\/\d+/.test(location.pathname);
  const [collapsed, setCollapsed] = useState(workspace);
  return <div className="min-h-screen bg-[#101317] text-[#d7dde4]">
    <div className="flex h-screen overflow-hidden">
      <aside className={`${collapsed ? 'w-[64px]' : 'w-[232px]'} shrink-0 border-r border-white/[0.06] bg-[#13171b] transition-[width] duration-200`}>
        <div className="flex h-14 items-center gap-2 border-b border-white/[0.06] px-3">
          <button onClick={() => setCollapsed(v => !v)} className="grid h-8 w-8 place-items-center rounded-md border border-white/[0.07] bg-white/[0.025] text-[#86a8da]"><Radio size={16}/></button>
          {!collapsed && <div><div className="text-sm font-semibold">SRS Manager</div><div className="text-[9px] tracking-[.14em] text-[#65707d]">LIVE OPERATIONS</div></div>}
        </div>
        <nav className="h-[calc(100vh-56px)] overflow-y-auto px-2 py-3">
          {navGroups.map(group => <div key={group.title} className="mb-4">
            {!collapsed && <div className="mb-1.5 px-2 text-[9px] font-semibold tracking-[.16em] text-[#5f6975]">{group.title}</div>}
            <div className="space-y-1">{group.items.map(([path, text, Icon]) => <NavLink key={path} to={`/design-lab/${path}`} className={({isActive}) => `flex h-9 items-center gap-2.5 rounded-md px-2 text-xs ${isActive ? 'bg-[#233044] text-[#dce9ff]' : 'text-[#89939f] hover:bg-white/[0.04] hover:text-[#d5dbe2]'}`}>
              <Icon size={15} className="shrink-0"/>{!collapsed && <span>{text}</span>}
            </NavLink>)}</div>
          </div>)}
        </nav>
      </aside>
      <section className="min-w-0 flex-1 overflow-hidden">
        <Routes>
          <Route path="rooms/:id" element={<WorkspacePage />} />
          <Route path="*" element={<GeneralFrame />} />
        </Routes>
      </section>
    </div>
  </div>;
}

function GeneralFrame() {
  return <div className="flex h-full flex-col">
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-white/[0.06] bg-[#12161a]/95 px-5">
      <div className="flex items-center gap-3"><span className={label}>SRS MANAGER V3</span><span className="h-4 w-px bg-white/[0.07]"/><Status tone="healthy"><Dot tone="healthy"/> LIVE-01 HEALTHY</Status></div>
      <div className="flex items-center gap-3 text-xs text-[#7e8995]"><Search size={14}/><span>18:42:31</span><span className="h-7 w-7 rounded-md border border-white/[0.07] bg-white/[0.03] text-center leading-7 text-[#c6ced7]">A</span></div>
    </header>
    <main className="flex-1 overflow-y-auto p-5 xl:p-6"><div className="mx-auto max-w-[1580px]"><GeneralRoutes/></div></main>
  </div>;
}

function GeneralRoutes() {
  return <Routes>
    <Route path="rooms" element={<RoomsPage/>}/><Route path="incidents" element={<IncidentsPage/>}/>
    <Route path="profiles" element={<ProfilesPage/>}/><Route path="run-plans" element={<RunPlansPage/>}/>
    <Route path="integrations" element={<IntegrationsPage/>}/><Route path="integrations/wangsu" element={<IntegrationDetailPage/>}/><Route path="dns" element={<DnsPage/>}/>
    <Route path="credentials" element={<CredentialsPage/>}/><Route path="system" element={<SystemPage/>}/><Route path="states" element={<StateCatalogPage/>}/>
    <Route path="settings" element={<SettingsPage/>}/><Route path="releases" element={<ReleasesPage/>}/>
    <Route path="rooms/:id/sessions/:sessionId" element={<SessionReplayPage/>}/><Route path="*" element={<RoomsPage/>}/>
  </Routes>;
}
function RoomsPage() {
  return <>
    <PageTitle eyebrow="LIVE OPERATIONS" title="直播间" description="所有直播间的实时运行态势。异常优先，正常保持安静。" action={<button className={primaryButton}><Plus size={14}/>新建直播间</button>}/>
    <div className="mb-5 grid grid-cols-5 gap-3">
      {[['ON AIR','3','healthy'],['DEGRADED','1','warning'],['OFF AIR','6','muted'],['RECORDING','2','rec'],['ACTIVE INCIDENT','1','danger']].map(([k,v,t]) => <div key={k} className={`${panel} px-4 py-3`}><div className="flex items-center gap-2"><Dot tone={t}/><span className="text-2xl font-semibold tabular-nums text-[#edf1f4]">{v}</span></div><div className="mt-1 text-[9px] font-semibold tracking-[.13em] text-[#68727e]">{k}</div></div>)}
    </div>
    <div className="space-y-2.5">{rooms.map(room => <RoomRow key={room.id} room={room}/>)}</div>
  </>;
}

function RoomRow({ room }) {
  const danger = room.health === 'DEGRADED';
  return <Link to={`/design-lab/rooms/${room.id}`} className={`grid grid-cols-[1.25fr_.9fr_1fr_1.1fr_.9fr_auto] items-center gap-4 rounded-xl border ${danger ? 'border-[#e2ac59]/22 bg-[#1d1d1a]' : 'border-white/[0.07] bg-[#191d22]'} px-4 py-3.5 hover:border-white/[0.13]`}>
    <div><div className="flex items-center gap-2"><Dot tone={room.state === 'ON AIR' ? (danger ? 'warning':'healthy'):'muted'}/><span className="text-sm font-semibold text-[#e6eaee]">{room.name}</span><Status tone={danger ? 'warning' : room.state === 'ON AIR' ? 'healthy':'muted'}>{room.state}</Status></div><div className="mt-1 text-[11px] text-[#77818c]">Session {room.session}</div></div>
    <Cell label="PROGRAM" value={room.program}/><Cell label="INPUT" value={room.input}/><Cell label="OUTPUTS" value={room.outputs}/><Cell label="RECORD" value={room.recording}/>
    <div className="justify-self-end text-right">{room.incident ? <div className="mb-1 text-[11px] text-[#edb768]">{room.incident}</div> : <div className="mb-1 text-[11px] text-[#6fca9a]">Health {room.health}</div>}<span className="inline-flex items-center gap-1 text-xs text-[#8caee2]">进入工作台 <ChevronRight size={13}/></span></div>
  </Link>;
}

function Cell({ label: name, value }) { return <div><div className={label}>{name}</div><div className="mt-1 text-xs text-[#b5bec8]">{value}</div></div>; }
function WorkspacePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const stateMap = { prep: 'PREP', onair: 'ON AIR', preview: 'PREVIEW', incident: 'INCIDENT', closing: 'CLOSING' };
  const [mode, setMode] = useState(stateMap[new URLSearchParams(location.search).get('state')] || 'ON AIR');
  const [drawer, setDrawer] = useState(null);
  const preview = mode === 'PREVIEW';
  const incident = mode === 'INCIDENT';
  const prep = mode === 'PREP';
  const closing = mode === 'CLOSING';
  return <div className="flex h-full flex-col bg-[#0f1216]">
    <div className="flex h-8 shrink-0 items-center justify-between border-b border-white/[0.055] bg-[#11151a] px-3 text-[10px] text-[#707b87]">
      <div className="flex items-center gap-3"><span className="font-semibold tracking-[.13em] text-[#8390a0]">SRS MANAGER / LIVE OPS</span><span>Node LIVE-01</span><span className="inline-flex items-center gap-1.5 text-[#6fc997]"><Dot tone="healthy"/> System Healthy</span><span>Workers 5/5</span></div>
      <div className="flex items-center gap-3"><span>18:42:31</span><span>Design Lab</span></div>
    </div>
    <div className="flex min-h-[62px] shrink-0 items-center justify-between border-b border-white/[0.065] bg-[#15191e] px-3.5">
      <div className="flex min-w-0 items-center gap-3"><button onClick={() => navigate('/design-lab/rooms')} className={button}><ArrowLeft size={13}/></button><div><div className="flex items-center gap-2"><span className="text-[15px] font-semibold text-[#ecf0f3]">晚间新闻直播</span><span className="text-[10px] text-[#6e7884]">Session #0917-01</span></div><div className="mt-1 flex items-center gap-3 text-[10px] text-[#7c8793]"><span>Run Plan · 晚间新闻标准方案</span><span>Program · 主编码器</span></div></div></div>
      <div className="flex items-center gap-2.5"><Status tone={closing ? 'warning' : prep ? 'blue' : incident ? 'warning' : 'healthy'}><Dot tone={closing ? 'warning' : prep ? 'blue' : incident ? 'warning' : 'healthy'}/>{closing ? 'CLOSING' : prep ? 'PREP' : 'ON AIR'}</Status><div className="text-sm font-semibold tabular-nums text-[#dfe5ea]">02:41:38</div><Status tone={incident ? 'warning' : prep ? 'blue' : 'healthy'}>{incident ? 'HEALTH DEGRADED' : prep ? 'PREFLIGHT READY' : 'HEALTH NORMAL'}</Status><span className="text-[10px] font-medium text-[#7e8995]">{incident ? 'Required 3/4' : 'Required 4/4'}</span><button className={button} onClick={() => setDrawer('session')}>本场详情</button><button className="inline-flex h-8 items-center rounded-md border border-[#e46b6b]/22 px-3 text-xs font-medium text-[#eb7c7c]">结束本场直播</button></div>
    </div>
    <div className="flex h-8 shrink-0 items-center justify-center gap-1 border-b border-white/[0.05] bg-[#12161b] px-3">
      {['PREP','ON AIR','PREVIEW','INCIDENT','CLOSING'].map(item => <button key={item} onClick={() => setMode(item)} className={`h-6 rounded px-2 text-[9px] font-semibold tracking-[.08em] ${mode === item ? 'bg-[#263752] text-[#8eb7f7]' : 'text-[#606b77] hover:text-[#9ca6b1]'}`}>{item}</button>)}
      <span className="ml-2 text-[9px] text-[#4f5965]">UI STATE SIMULATOR · DESIGN LAB ONLY</span>
    </div>
    <div className="grid min-h-0 flex-1 grid-cols-[22%_43%_35%]">
      <InputRack onDrawer={setDrawer} preview={preview} onPreview={() => setMode('PREVIEW')}/>
      <ProgramSurface preview={preview} prep={prep} incident={incident}/>
      <OutputRack prep={prep} incident={incident} closing={closing} onDrawer={setDrawer}/>
    </div>
    <SignalRoute prep={prep} incident={incident} closing={closing}/>
    <OperationsDock incident={incident} closing={closing}/>
    {drawer && <WorkspaceDrawer type={drawer} onClose={() => setDrawer(null)}/>} 
  </div>;
}

function InputRack({ onDrawer, preview, onPreview }) {
  return <section className="min-h-0 overflow-y-auto border-r border-white/[0.06] bg-[#14181d] p-3">
    <div className="mb-3 flex items-center justify-between"><div><div className={label}>INPUT RACK</div><div className="mt-1 text-xs text-[#aeb7c1]">输入保护 <span className="text-[#6fca9a]">● Protected</span> · 2 Standby</div></div><button className={button} onClick={() => onDrawer('source')}><Plus size={12}/></button></div>
    {['PROGRAM','STANDBY','OFFLINE'].map(role => <div key={role} className="mb-3"><div className="mb-1.5 text-[9px] font-semibold tracking-[.14em] text-[#5f6975]">{role}</div><div className="space-y-1.5">{sources.filter(x => x.role === role).map(src => <div key={src.name} className={`${panelSoft} ${src.role === 'PROGRAM' ? 'border-[#5b9aff]/25 bg-[#192333]' : ''} px-3 py-2.5`}><div className="flex items-center justify-between gap-2"><div className="flex items-center gap-2"><Dot tone={src.state === 'OFFLINE' ? 'muted' : src.role === 'PROGRAM' ? 'healthy' : 'blue'}/><span className="text-xs font-semibold text-[#d8dee4]">{src.name}</span></div>{src.role === 'STANDBY' && <button onClick={onPreview} className="text-[10px] text-[#78a9ef]">{preview && src.name === '备编码器' ? '预监中':'预监'}</button>}</div><div className="mt-1.5 text-[10px] text-[#77828e]">{src.protocol} · {src.meta}</div><div className="mt-1 text-[9px] text-[#5f6975]">{src.uptime}</div></div>)}</div></div>)}
  </section>;
}
function ProgramSurface({ preview, prep, incident }) {
  return <section className="min-h-0 overflow-y-auto bg-[#11151a] p-3">
    <div className="mb-2 flex items-center justify-between"><div><div className={label}>PROGRAM CONTROL SURFACE</div><div className="mt-1 text-xs text-[#aab4be]">当前节目 · 主编码器</div></div><Status tone={incident ? 'warning' : prep ? 'blue' : 'healthy'}>{prep ? 'READY' : incident ? 'DEGRADED' : 'PROGRAM LIVE'}</Status></div>
    <div className={`grid gap-2 ${preview ? 'grid-cols-[68%_32%]' : 'grid-cols-1'}`}>
      <Monitor title="PROGRAM" tag={prep ? "PGM · READY" : "PGM · ON AIR"} tone={prep ? "blue" : "healthy"} />
      {preview && <Monitor title="备编码器" tag="PVW · NOT PROGRAM" tone="blue" small />}
    </div>
    <div className={`${panelSoft} mt-2 p-3`}><AudioMeter channel="L" value="-12.4" width="78%"/><AudioMeter channel="R" value="-14.1" width="70%"/></div>
    <div className="mt-2 grid grid-cols-2 gap-2"><div className={`${panelSoft} p-3`}><div className={label}>SIGNAL HEALTH</div><div className="mt-2 grid grid-cols-2 gap-y-2 text-[11px]"><HealthItem name="Video" ok/><HealthItem name="Audio" ok/><HealthItem name="Bitrate" ok/><HealthItem name="Publisher" ok/></div></div><div className={`${panelSoft} p-3`}><div className={label}>MEDIA FACTS</div><div className="mt-2 space-y-1 text-[11px] text-[#a9b3bd]"><div>H.264 · 1920×1080 · 25fps</div><div>AAC · 48kHz · Stereo</div><div>8.1 Mbps · GOP observed 2.0s</div></div></div></div>
    {prep && <div className="mt-2 rounded-lg border border-[#5b9aff]/20 bg-[#5b9aff]/6 p-3"><div className="text-xs font-semibold text-[#9bc0fa]">开播前检查已完成</div><div className="mt-1 text-[10px] text-[#8797aa]">主输入、备用输入、Required Outputs 与录制均已就绪；1 项安全策略警告。</div></div>}
  </section>;
}

function Monitor({ title, tag, tone, small }) {
  return <div className={`${panelSoft} relative flex aspect-video min-h-[150px] items-center justify-center overflow-hidden bg-[#090c0f]`}><div className="absolute inset-0 opacity-30" style={{background:'radial-gradient(circle at 65% 35%, #234b67 0, transparent 35%), linear-gradient(140deg,#101820,#080b0e)'}}/><div className="relative text-center"><Video size={small ? 24 : 34} className="mx-auto mb-2 text-[#405161]"/><div className="text-xs font-semibold text-[#909ba6]">{title}</div><div className="mt-1 text-[9px] text-[#57616c]">Secure HTTP-FLV Preview</div></div><div className="absolute left-2 top-2"><Status tone={tone}><Dot tone={tone}/>{tag}</Status></div></div>;
}

function AudioMeter({ channel, value, width }) { return <div className="mb-2 flex items-center gap-2 last:mb-0"><span className="w-3 text-[10px] font-semibold text-[#818d99]">{channel}</span><div className="h-2 flex-1 overflow-hidden rounded-sm bg-[#0d1115]"><div className="h-full rounded-sm bg-gradient-to-r from-[#3d7b67] to-[#6ac596]" style={{width}}/></div><span className="w-12 text-right font-mono text-[10px] text-[#9aa5af]">{value}</span></div>; }
function HealthItem({ name, ok }) { return <div className="flex items-center gap-1.5"><Dot tone={ok ? 'healthy':'warning'}/><span className="text-[#9ea8b2]">{name}</span><span className="text-[#68737f]">{ok ? 'Present':'Check'}</span></div>; }
function OutputRack({ prep, incident, closing, onDrawer }) {
  const data = outputs.map(item => incident && item.name === '视频号' ? { ...item, state: 'RETRYING', evidence: 'Connection reset · retry 2/5' } : item);
  const groups = ['PRIMARY','PARTNERS','RECORDING'];
  return <section className="min-h-0 overflow-y-auto border-l border-white/[0.06] bg-[#14181d] p-3">
    <div className="mb-3 flex items-start justify-between"><div><div className={label}>OUTPUT RACK</div><div className="mt-1 text-xs text-[#aeb7c1]">{closing ? '0 Running · 1 Finalizing · 0 Failed' : prep ? '4 Ready · 1 Record Ready · 0 Failed' : incident ? '3 Running · 1 Recording · 1 Failed' : '4 Running · 1 Recording · 0 Failed'}</div><div className="mt-1 text-[10px] text-[#707b87]">{closing ? '0 Mbps outbound · recording finalizing' : prep ? 'Outputs armed · no outbound traffic' : '23.8 Mbps outbound · Remote 2/4 verified'}</div></div><button className={primaryButton} onClick={() => onDrawer('output')}><Plus size={12}/>新建</button></div>
    {incident && <div className="mb-3 rounded-lg border border-[#e2ac59]/24 bg-[#2a2115] p-3"><div className="flex items-center justify-between"><div className="flex items-center gap-2 text-xs font-semibold text-[#f0bf70]"><AlertTriangle size={13}/>视频号输出中断</div><Status tone="warning">RETRYING 2/5</Status></div><div className="mt-1.5 text-[10px] text-[#a28d6f]">影响：仅视频号。Program、CDN 与录像正常。</div><div className="mt-2 flex gap-2"><button className={button}>立即重试</button><button className={button} onClick={() => onDrawer('evidence')}>查看证据</button></div></div>}
    {groups.map(group => <div key={group} className="mb-3"><div className="mb-1.5 text-[9px] font-semibold tracking-[.14em] text-[#5f6975]">{group}</div><div className="space-y-1.5">{data.filter(x => x.group === group).map(item => <OutputRow key={item.name} item={item} prep={prep} closing={closing} onEvidence={() => onDrawer('evidence')}/>)}</div></div>)}
  </section>;
}

function OutputRow({ item, prep, closing, onEvidence }) {
  const retry = item.state === 'RETRYING';
  const rec = item.state === 'REC';
  const state = closing ? (rec ? 'FINALIZING':'STOPPED') : prep ? 'READY' : item.state;
  return <button onClick={onEvidence} className={`${panelSoft} w-full px-3 py-2.5 text-left hover:border-white/[0.12]`}><div className="flex items-center justify-between"><div className="flex items-center gap-2"><Dot tone={retry ? 'warning' : rec ? 'rec' : state === 'STOPPED' ? 'muted':'healthy'}/><span className="text-xs font-semibold text-[#d8dee4]">{rec && !closing ? 'REC · ':''}{item.name}</span></div><span className={`text-[9px] font-semibold ${retry ? 'text-[#efbd6c]' : rec && !closing ? 'text-[#ef7b82]' : state === 'STOPPED' ? 'text-[#69737f]':'text-[#70cc99]'}`}>{state}</span></div><div className="mt-1.5 flex items-center justify-between gap-2 text-[10px]"><span className="text-[#7f8994]">{item.media} · {item.route}</span><span className="text-[#9ba5af]">{item.evidence}</span></div></button>;
}

function SignalRoute({ prep, incident, closing }) {
  return <div className="shrink-0 border-t border-white/[0.06] bg-[#12161a] px-3 py-2"><div className="mb-1 flex items-center gap-2"><span className={label}>SIGNAL ROUTE</span><span className="text-[9px] text-[#56606c]">LIVE IMPACT MAP</span></div><div className="flex items-center gap-2 text-[10px] text-[#89939e]"><RouteNode tone="healthy">主编码器</RouteNode><ArrowRight size={12}/><RouteNode tone="healthy">PROGRAM</RouteNode><ArrowRight size={12}/><RouteNode tone="healthy">1080P</RouteNode><ArrowRight size={12}/><RouteNode tone={closing ? 'muted' : prep ? 'blue' : incident ? 'warning':'healthy'}>视频号</RouteNode><span className="text-[#4c5661]">/</span><RouteNode tone={closing ? 'muted' : prep ? 'blue' : 'healthy'}>网宿</RouteNode><span className="text-[#4c5661]">/</span><RouteNode tone={closing ? 'muted' : prep ? 'blue' : 'healthy'}>官网</RouteNode><span className="ml-4 text-[#4c5661]">└</span><RouteNode tone="blue">720P</RouteNode><ArrowRight size={12}/><RouteNode tone={closing ? 'muted' : prep ? 'blue' : 'healthy'}>合作方 A</RouteNode><span className="ml-4 text-[#4c5661]">└</span><RouteNode tone={closing ? 'warning' : prep ? 'blue' : 'rec'}>REC</RouteNode></div></div>;
}
function RouteNode({ children, tone }) { return <span className="inline-flex items-center gap-1.5 rounded border border-white/[0.07] bg-white/[0.025] px-2 py-1"><Dot tone={tone}/>{children}</span>; }
function OperationsDock({ incident, closing }) {
  const [tab, setTab] = useState('INCIDENTS');
  const tabs = ['INCIDENTS','EVENTS','OPERATIONS','RESOURCES'];
  return <div className="shrink-0 border-t border-white/[0.06] bg-[#11151a]">
    <div className="flex h-8 items-center gap-1 border-b border-white/[0.045] px-3">{tabs.map(t => <button key={t} onClick={() => setTab(t)} className={`h-7 px-2 text-[9px] font-semibold tracking-[.1em] ${tab === t ? 'border-b border-[#5b9aff] text-[#91b8f5]' : 'text-[#59636f]'}`}>{t}{t === 'INCIDENTS' && incident ? ' 1':''}</button>)}</div>
    <div className="flex h-10 items-center justify-between px-3 text-[10px] text-[#78838f]">
      <div>{tab === 'INCIDENTS' ? (incident ? <span className="text-[#e8b262]">视频号连接中断 · 自动重试 2/5 · Program 与其他输出不受影响</span> : 'No active incidents') : tab === 'EVENTS' ? '18:12 Program switched · 主编码器 → SRT 备源 · 18:14 restored' : tab === 'OPERATIONS' ? (closing ? 'End Session · FINALIZING RECORD · 4/5 steps complete' : 'No active operations') : 'CPU 42% · RAM 1.8/4GB · NET ↑108 Mbps · DISK 428GB · ~11h recording'}</div>
      <div className="flex items-center gap-3"><span>Evidence fresh &lt; 2s</span><span>5/5 Workers</span></div>
    </div>
  </div>;
}

function WorkspaceDrawer({ type, onClose }) {
  const titles = { source: '添加输入来源', output: '创建输出', evidence: '运行证据', session: '本场直播详情' };
  return <div className="absolute inset-0 z-40 flex justify-end bg-black/35" onClick={onClose}><aside onClick={e => e.stopPropagation()} className="h-full w-[560px] border-l border-white/[0.08] bg-[#171b20] shadow-[-24px_0_70px_rgba(0,0,0,.35)]"><div className="flex h-14 items-center justify-between border-b border-white/[0.06] px-5"><div><div className={label}>WORKSPACE DRAWER</div><div className="mt-0.5 text-sm font-semibold text-[#e4e9ed]">{titles[type]}</div></div><button onClick={onClose} className={button}><X size={14}/></button></div><div className="h-[calc(100%-56px)] overflow-y-auto p-5">{type === 'source' ? <SourceDrawer/> : type === 'output' ? <OutputDrawer/> : type === 'evidence' ? <EvidenceDrawer/> : <SessionDrawer/>}</div></aside></div>;
}

function SourceDrawer() { return <div><p className="text-xs leading-5 text-[#7f8994]">这个信号从哪里来？场景入口决定后续参数，只展示当前 Runtime 真正支持的能力。</p><div className="mt-4 grid grid-cols-2 gap-2">{[['编码器 / OBS 推给我','RTMP / RTMPS'],['从远端地址拉取','RTMP / HLS / FLV'],['SRT 专线','Caller / Listener'],['IP 摄像机 / RTSP','Managed Pull']].map(([a,b]) => <button key={a} className={`${panelSoft} p-4 text-left hover:border-[#5b9aff]/30`}><div className="text-xs font-semibold text-[#dbe1e7]">{a}</div><div className="mt-1 text-[10px] text-[#69747f]">{b}</div></button>)}</div><div className="mt-5 rounded-lg border border-[#5b9aff]/15 bg-[#5b9aff]/5 p-3 text-[10px] text-[#7f92ac]">PUSH Source 将获得独立 Ingest Credential；不会与其他来源共享业务 Stream Key。</div></div>; }
function OutputDrawer() {
  const [mode, setMode] = useState('scene');
  return <div><div className="flex gap-1 rounded-lg border border-white/[0.06] bg-[#11151a] p-1"><button onClick={() => setMode('scene')} className={`flex-1 rounded-md px-3 py-2 text-xs ${mode === 'scene' ? 'bg-[#263752] text-[#a7c7f7]' : 'text-[#74808d]'}`}>场景模式</button><button onClick={() => setMode('pro')} className={`flex-1 rounded-md px-3 py-2 text-xs ${mode === 'pro' ? 'bg-[#263752] text-[#a7c7f7]' : 'text-[#74808d]'}`}>专业模式</button></div>
    {mode === 'scene' ? <div className="mt-4 grid grid-cols-2 gap-2">{['推到直播平台','推到 CDN','作为 CDN 回源','合作方拉流','SRT 专线','音频输出','本地录制','专业自定义'].map(x => <button key={x} className={`${panelSoft} p-3.5 text-left text-xs font-medium text-[#cbd2da] hover:border-[#5b9aff]/30`}>{x}</button>)}</div> : <div className="mt-4 space-y-3">{[['Media','1080P Broadcast'],['Processing','Shared Rendition'],['Mode','PUSH'],['Transport','RTMP'],['Protection','Provider Auth'],['Destination','Custom / Provider']].map(([a,b]) => <div key={a} className={`${panelSoft} flex items-center justify-between px-3 py-3`}><span className="text-[10px] font-semibold tracking-[.1em] text-[#697480]">{a}</span><span className="text-xs text-[#cbd2da]">{b}</span></div>)}<div className="rounded-lg border border-[#56c98f]/18 bg-[#56c98f]/5 p-3 text-[10px] text-[#79cfa2]">✓ 当前 Product / Runtime / Destination 能力组合合法</div></div>}
    <div className="mt-5 flex justify-end gap-2"><button className={button}>保存但不启动</button><button className={primaryButton}>保存并启动</button></div></div>;
}

function EvidenceDrawer() { return <div className="space-y-4"><div><div className={label}>VIDEO号 / OUTPUT EVIDENCE</div><div className="mt-1 text-xs text-[#9ca7b2]">Configured ≠ Runtime ≠ Observed ≠ Remote Verified</div></div>{[['LOCAL','Worker','RUNNING'],['LOCAL','Socket','CONNECTED'],['LOCAL','Bitrate','5.81 Mbps'],['LOCAL','Last packet','0.4s ago'],['REMOTE','Platform','UNKNOWN']].map(([scope,a,b],i) => <div key={a} className={`${panelSoft} flex items-center justify-between px-3 py-3`}><div className="flex items-center gap-2"><Status tone={scope === 'LOCAL' ? 'blue':'muted'}>{scope}</Status><span className="text-xs text-[#909ba6]">{a}</span></div><span className={`text-xs font-medium ${i < 4 ? 'text-[#72cf9c]' : 'text-[#858f99]'}`}>{b}</span></div>)}<div className={`${panelSoft} p-3`}><div className={label}>PROVENANCE</div><div className="mt-2 text-[11px] leading-5 text-[#89949f]">Push Worker · FFmpeg stats · last refreshed 0.4s ago</div></div></div>; }

function SessionDrawer() { return <div className="space-y-3"><div className={`${panelSoft} p-4`}><div className={label}>SESSION</div><div className="mt-2 text-base font-semibold text-[#e5eaee]">晚间新闻直播</div><div className="mt-1 text-xs text-[#7d8792]">Run Plan · 晚间新闻标准方案 · ON AIR 02:41:38</div></div><div className={`${panelSoft} p-4`}><div className={label}>REQUIRED</div><div className="mt-2 space-y-2 text-xs text-[#abb4be]">{['Program · 主编码器','官网 CDN','网宿 CDN','本地录像'].map(x => <div key={x} className="flex items-center gap-2"><Dot tone="healthy"/>{x}</div>)}</div></div><div className={`${panelSoft} p-4`}><div className={label}>OPTIONAL</div><div className="mt-2 space-y-2 text-xs text-[#abb4be]"><div className="flex items-center gap-2"><Dot tone="healthy"/>视频号</div><div className="flex items-center gap-2"><Dot tone="healthy"/>合作方 A</div></div></div><Link to="/design-lab/rooms/1/sessions/20260917-01" className={button}>查看历史场次</Link></div>; }
function ProfilesPage() { return <><PageTitle eyebrow="RESOURCES / MEDIA" title="媒体规格" description="可复用的视频、音频和 Passthrough 规格。Workspace 只选择规格，不重复理解编码参数。" action={<button className={primaryButton}><Plus size={14}/>新建媒体规格</button>}/><div className="grid gap-3 xl:grid-cols-2">{profiles.map(p => <div key={p.name} className={`${panel} p-4`}><div className="flex items-start justify-between gap-4"><div><Status tone="blue">{p.type}</Status><h3 className="mt-3 text-[15px] font-semibold text-[#e4e9ed]">{p.name}</h3></div><span className="text-[10px] text-[#66717d]">Used by {p.usage}</span></div><div className="mt-4 grid grid-cols-2 gap-2"><div className={`${panelSoft} p-3`}><div className={label}>VIDEO</div><div className="mt-1.5 text-xs leading-5 text-[#aab4be]">{p.video}</div></div><div className={`${panelSoft} p-3`}><div className={label}>AUDIO</div><div className="mt-1.5 text-xs leading-5 text-[#aab4be]">{p.audio}</div></div></div><div className="mt-3 flex gap-2"><button className={button}>编辑</button><button className={button}><Copy size={12}/>复制</button></div></div>)}</div></>; }

function RunPlansPage() { return <><PageTitle eyebrow="RESOURCES / RUN PLANS" title="开播方案" description="把 Program、Required/Optional Outputs、录制和 Failover 意图组合成可复用的本场直播计划。" action={<button className={primaryButton}><Plus size={14}/>新建开播方案</button>}/><div className="grid gap-3 xl:grid-cols-2">{runPlans.map(p => <div key={p.name} className={`${panel} p-4`}><div className="flex items-start justify-between"><div><h3 className="text-[15px] font-semibold text-[#e5eaee]">{p.name}</h3><div className="mt-1 text-xs text-[#78838f]">Program · {p.program}</div></div><Status tone="healthy">READY</Status></div><div className="mt-4 grid grid-cols-2 gap-3"><PlanList title="REQUIRED" items={p.required}/><PlanList title="OPTIONAL" items={p.optional}/></div><div className={`${panelSoft} mt-3 p-3`}><div className={label}>FAILOVER</div><div className="mt-1.5 text-xs text-[#a9b2bc]">{p.failover}</div></div><div className="mt-3 flex gap-2"><button className={primaryButton}>应用到直播间</button><button className={button}>编辑</button><button className={button}>复制</button></div></div>)}</div></>; }
function PlanList({title,items}) { return <div className={`${panelSoft} p-3`}><div className={label}>{title}</div><div className="mt-2 space-y-1.5">{items.map(x => <div key={x} className="flex items-center gap-2 text-xs text-[#a8b1bb]"><Dot tone="healthy"/>{x}</div>)}</div></div>; }
function IncidentsPage() { return <><PageTitle eyebrow="OPERATIONS" title="告警中心" description="跨直播间聚合真正需要处理的业务异常，不把所有技术事件都升级成告警。"/><div className="mb-4 grid grid-cols-3 gap-3">{[['CRITICAL','1','danger'],['WARNING','3','warning'],['ACKNOWLEDGED','2','blue']].map(([a,b,t]) => <div key={a} className={`${panel} p-4`}><div className="flex items-center gap-2"><Dot tone={t}/><span className="text-xl font-semibold">{b}</span></div><div className="mt-1 text-[9px] tracking-[.12em] text-[#69737e]">{a}</div></div>)}</div><div className="space-y-2">{incidents.map(i => <div key={i.title} className={`${panel} grid grid-cols-[1fr_1.6fr_1fr_auto] items-center gap-4 p-4`}><div><Status tone={i.severity === 'CRITICAL' ? 'danger':'warning'}>{i.severity}</Status><div className="mt-2 text-xs text-[#8b96a1]">{i.room}</div></div><div><div className="text-sm font-semibold text-[#dfe4e9]">{i.title}</div><div className="mt-1 text-xs text-[#7a8590]">{i.impact}</div></div><div className="text-xs text-[#8c96a0]">{i.state} · {i.duration}</div><button className={button}>进入处理</button></div>)}</div></>; }

function IntegrationsPage() { return <><PageTitle eyebrow="INTEGRATIONS" title="平台与 CDN" description="外部 Provider 的账户、能力、频道和远端运行证据统一入口。" action={<button className={primaryButton}><Plus size={14}/>添加集成</button>}/><div className="grid gap-3 xl:grid-cols-2"><IntegrationCard name="网宿 CDN" meta="3 Channels · Remote Evidence available" caps={['RTMP Push','Origin Pull','Remote ingest status','Audience metrics']}/><IntegrationCard name="自定义 RTMP 平台" meta="2 Destinations · Local evidence only" caps={['RTMP Push','URL Credential','Custom endpoint']}/></div></>; }
function IntegrationCard({name,meta,caps}) { return <div className={`${panel} p-4`}><div className="flex items-start justify-between"><div><div className="flex items-center gap-2"><Cloud size={16} className="text-[#79aaf2]"/><span className="text-[15px] font-semibold text-[#e2e7ec]">{name}</span></div><div className="mt-1 text-xs text-[#747f8a]">{meta}</div></div><Status tone="healthy"><Dot tone="healthy"/>CONNECTED</Status></div><div className="mt-4"><div className={label}>CAPABILITIES</div><div className="mt-2 flex flex-wrap gap-1.5">{caps.map(c => <Status key={c} tone="muted">✓ {c}</Status>)}</div></div><Link to={name === '网宿 CDN' ? '/design-lab/integrations/wangsu' : '/design-lab/integrations'} className={`${button} mt-4`}>查看详情</Link></div>; }
function DnsPage() { return <><PageTitle eyebrow="INTEGRATIONS / DNS" title="DNS" description="域名、Provider、解析事实和最近同步状态；API 凭据由凭据中心引用。"/><div className={`${panel} overflow-hidden`}><div className="grid grid-cols-[1.3fr_1fr_1fr_1fr_.8fr] border-b border-white/[0.06] px-4 py-2.5 text-[9px] font-semibold tracking-[.12em] text-[#69737f]"><span>DOMAIN</span><span>PROVIDER</span><span>RECORD</span><span>RESOLVED</span><span>STATE</span></div>{[['live.example.com','Aliyun DNS','CNAME · live-origin','10.30.5.199'],['cdn.example.com','Wangsu DNS','CNAME · edge','wangsu-edge']].map(r => <div key={r[0]} className="grid grid-cols-[1.3fr_1fr_1fr_1fr_.8fr] items-center border-b border-white/[0.045] px-4 py-3 text-xs text-[#a7b0ba] last:border-b-0">{r.map(x => <span key={x}>{x}</span>)}<Status tone="healthy">SYNCED</Status></div>)}</div></>; }

function CredentialsPage() { const groups=[['PROVIDER CREDENTIALS',['网宿 API','阿里云 DNS']],['INGEST CREDENTIALS',['新闻主编码器','新闻备编码器']],['ACCESS GRANTS',['合作方 A','合作方 B']]]; return <><PageTitle eyebrow="SECURITY" title="凭据与访问控制" description="全局审计、轮换、失效和绑定关系；业务创建仍从对应 Room / Integration 发起。"/>{groups.map(([g,items]) => <div key={g} className="mb-4"><div className={`mb-2 ${label}`}>{g}</div><div className="space-y-2">{items.map((x,i) => <div key={x} className={`${panel} grid grid-cols-[1.5fr_1fr_1fr_auto] items-center gap-4 px-4 py-3`}><div className="flex items-center gap-2"><FileKey2 size={14} className="text-[#739edb]"/><span className="text-sm font-medium text-[#dce2e7]">{x}</span></div><span className="text-xs text-[#7e8994]">Last used · {i ? '2h ago':'4m ago'}</span><span className="text-xs text-[#7e8994]">Bound resources · {i+1}</span><Status tone="healthy">ACTIVE</Status></div>)}</div></div>)}</>; }

function SystemPage() { const items=[['SRS','Active'],['Manager','Active'],['Pull Worker','Active'],['Push Worker','Active'],['Transcode Worker','Active'],['FFmpeg','Available'],['SRT','Available'],['Storage','428 GB free']]; return <><PageTitle eyebrow="SYSTEM" title="节点与运行环境" description="先展示业务可用性，再渐进披露 PID、端口、二进制路径和版本等工程细节。"/><div className={`${panel} p-5`}><div className="flex items-start justify-between"><div><div className="flex items-center gap-2"><Server size={18} className="text-[#78a9ef]"/><h2 className="text-base font-semibold">LIVE-01</h2></div><div className="mt-1 text-xs text-[#747f8a]">Ubuntu · Production Runtime</div></div><Status tone="healthy"><Dot tone="healthy"/>HEALTHY</Status></div><div className="mt-5 grid grid-cols-2 gap-2 xl:grid-cols-4">{items.map(([a,b]) => <div key={a} className={`${panelSoft} p-3`}><div className={label}>{a}</div><div className="mt-1.5 flex items-center gap-2 text-xs text-[#aeb7c1]"><Dot tone="healthy"/>{b}</div></div>)}</div></div></>; }
function SettingsPage() { return <><PageTitle eyebrow="SYSTEM" title="系统设置" description="只放真正的全局默认策略，不承载 Provider、媒体规格或具体直播业务配置。"/><div className="grid gap-3 xl:grid-cols-2">{[['Preview Policy','HTTP-FLV first · HLS fallback · secure proxy'],['Storage Root','/data/recordings · 15% low-space warning'],['Runtime Defaults','Retry / timeout / freshness policies'],['Operator UI','Dense workspace · reduced motion aware']].map(([a,b]) => <div key={a} className={`${panel} p-4`}><div className="flex items-center gap-2"><SlidersHorizontal size={14} className="text-[#779ed5]"/><span className="text-sm font-semibold text-[#dfe4e8]">{a}</span></div><div className="mt-2 text-xs leading-5 text-[#7d8893]">{b}</div><button className={`${button} mt-3`}>配置</button></div>)}</div></>; }

function ReleasesPage() { return <><PageTitle eyebrow="SYSTEM / RELEASES" title="版本与发布" description="版本、变更、验证证据和现场验收放在同一处。"/><div className={`${panel} p-5`}><div className="flex items-start justify-between"><div><Status tone="healthy">CURRENT STABLE</Status><h2 className="mt-3 text-xl font-semibold text-[#e8edf1]">v0.5.1</h2><div className="mt-1 text-xs text-[#75808b]">Workspace V2 Preview Hardening · 2026-09-17</div></div><Archive size={24} className="text-[#6f8db9]"/></div><div className="mt-5 grid grid-cols-2 gap-2 xl:grid-cols-4">{['Backend regression','Frontend build','Container gate','Field verification'].map(x => <div key={x} className={`${panelSoft} flex items-center gap-2 p-3 text-xs text-[#aeb7c0]`}><Dot tone="healthy"/>{x}</div>)}</div></div></>; }


function SessionReplayPage() {
  return <><PageTitle eyebrow="LIVE OPERATIONS / SESSION REVIEW" title="晚间新闻直播 · 场次复盘" description="只读还原一次真实直播：计划、实际 Program、输出结果、录制产物与 Incident Timeline。" action={<Link to="/design-lab/rooms/1" className={button}><ArrowLeft size={12}/>返回直播间</Link>}/>
    <div className="grid gap-3 xl:grid-cols-[1.15fr_.85fr]">
      <div className={`${panel} p-4`}><div className="flex items-start justify-between"><div><Status tone="healthy">ENDED · VERIFIED</Status><h2 className="mt-3 text-base font-semibold text-[#e5eaee]">2026-09-17 晚间新闻</h2><div className="mt-1 text-xs text-[#7a8590]">17:54:32 → 18:36:08 · 41m36s</div></div><div className="text-right"><div className={label}>RUN PLAN</div><div className="mt-1 text-xs text-[#aab4bd]">晚间新闻标准方案</div></div></div>
        <div className="mt-4 grid grid-cols-3 gap-2"><ReplayFact title="PROGRAM" value="主编码器 → SRT 备源 → 主编码器"/><ReplayFact title="OUTPUTS" value="3 normal · 视频号中断 8s"/><ReplayFact title="RECORD" value="41m36s · 38.4GB · COMPLETE"/></div>
        <div className="mt-4"><div className={label}>TIMELINE</div><div className="mt-2 space-y-2">{[['18:12:03','视频号输出连接中断','warning'],['18:12:05','Program 主编码器 → SRT 备源','blue'],['18:12:11','视频号自动恢复','healthy'],['18:14:11','Program 恢复主编码器','healthy']].map(([t,e,tone]) => <div key={t+e} className={`${panelSoft} flex items-center gap-3 px-3 py-2.5`}><span className="w-16 font-mono text-[10px] text-[#68737e]">{t}</span><Dot tone={tone}/><span className="text-xs text-[#abb4be]">{e}</span></div>)}</div></div>
      </div>
      <div className="space-y-3"><div className={`${panel} p-4`}><div className={label}>INCIDENT SUMMARY</div><div className="mt-3 text-sm font-semibold text-[#e0e5e9]">1 Incident · 已恢复</div><p className="mt-2 text-xs leading-5 text-[#7f8994]">视频号 RTMP 输出中断 8 秒；Program、CDN 与录制不受影响。自动重试成功。</p></div><div className={`${panel} p-4`}><div className={label}>RECORDING ASSET</div><div className="mt-3 text-sm font-semibold text-[#e0e5e9]">20260917_evening_news_001.mp4</div><div className="mt-2 text-xs text-[#7f8994]">FINALIZED · 38.4 GB · Recoverable source retained</div></div></div>
    </div></>;
}
function ReplayFact({ title, value }) { return <div className={`${panelSoft} p-3`}><div className={label}>{title}</div><div className="mt-2 text-xs leading-5 text-[#aab4be]">{value}</div></div>; }

function IntegrationDetailPage() {
  return <><PageTitle eyebrow="INTEGRATIONS / PROVIDER" title="网宿 CDN" description="Provider 的账户状态、能力、频道和远端证据。Workspace 只消费这里声明且当前可用的 Capability。" action={<Link to="/design-lab/integrations" className={button}><ArrowLeft size={12}/>返回集成</Link>}/>
    <div className="grid gap-3 xl:grid-cols-[.8fr_1.2fr]">
      <div className="space-y-3"><div className={`${panel} p-4`}><div className="flex items-center justify-between"><div><div className={label}>ACCOUNT</div><div className="mt-2 text-sm font-semibold text-[#e1e6ea]">Wangsu Production</div></div><Status tone="healthy"><Dot tone="healthy"/>CONNECTED</Status></div><div className="mt-3 text-xs text-[#7e8994]">Last verified · 18:42:27 · Provider API</div></div><div className={`${panel} p-4`}><div className={label}>CAPABILITIES</div><div className="mt-3 flex flex-wrap gap-2">{['RTMP PUSH','Origin Pull','Remote ingest status','Audience metrics'].map(x => <Status key={x} tone="healthy">✓ {x}</Status>)}</div><div className="mt-3 flex flex-wrap gap-2">{['SRT PUSH','WebRTC'].map(x => <Status key={x} tone="muted">— {x} unavailable</Status>)}</div></div></div>
      <div className={`${panel} overflow-hidden`}><div className="border-b border-white/[0.06] px-4 py-3"><div className={label}>CHANNELS</div></div>{[['新闻直播 CDN','Origin Pull · HLS/HTTP-FLV','AVAILABLE','428 viewers'],['发布会直播','RTMP Push','REMOTE VERIFIED','216 viewers'],['应急频道','Origin Pull','OFF AIR','0 viewers']].map(([a,b,c,d]) => <div key={a} className="grid grid-cols-[1.2fr_1fr_.8fr_.7fr] items-center border-b border-white/[0.045] px-4 py-3 last:border-0"><div className="text-sm font-medium text-[#dce2e7]">{a}</div><div className="text-xs text-[#7d8893]">{b}</div><Status tone={c === 'OFF AIR' ? 'muted':'healthy'}>{c}</Status><div className="text-right text-xs text-[#8d98a3]">{d}</div></div>)}</div>
    </div></>;
}

function StateCatalogPage() {
  const states = [
    ['Loading','正在读取直播间运行事实…','blue'],
    ['Empty','尚未创建直播间。创建后从这里进入值守工作台。','muted'],
    ['Error','无法读取 SRS Runtime。保留最后可信状态，并提供重试。','danger'],
    ['Capability unavailable','当前节点未提供 NVENC；不显示伪可用的编码选项。','warning'],
    ['Permission denied','当前账号无权执行高风险操作；状态仍可查看。','warning'],
  ];
  return <><PageTitle eyebrow="DESIGN SYSTEM / STATES" title="状态样板" description="后续 Agent 遇到 Loading、Empty、Error 或能力缺失时必须复用这些语义，不得临时创造另一套视觉语言。"/><div className="grid gap-3 xl:grid-cols-2">{states.map(([a,b,t]) => <div key={a} className={`${panel} p-5`}><div className="flex items-center justify-between"><h3 className="text-sm font-semibold text-[#e2e7eb]">{a}</h3><Status tone={t}>{a.toUpperCase()}</Status></div><p className="mt-3 text-xs leading-5 text-[#7e8994]">{b}</p><div className="mt-4 flex gap-2">{a === 'Error' && <button className={primaryButton}>重试</button>}{a === 'Loading' && <span className="inline-flex items-center gap-2 text-xs text-[#7ea8e8]"><Activity size={13}/>Refreshing evidence</span>}{a === 'Empty' && <button className={primaryButton}><Plus size={13}/>创建直播间</button>}{a.includes('Capability') && <button className={button}>查看原因</button>}{a === 'Permission denied' && <button className={button}>查看权限要求</button>}</div></div>)}</div></>;
}

export default function DesignLab() { return <DesignLabShell/>; }
