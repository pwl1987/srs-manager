import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Cloud, FileKey2, Globe2, Network } from 'lucide-react';
import { api } from '../lib/api';
import { usePolling } from '../lib/use-polling';
import { btnSecondary } from '../components/ui/styles';

function Card({ icon:Icon, title, status, meta, capabilities, to }) {
  return <article className="rounded-xl border border-[var(--border-soft)] bg-[var(--card)] p-4 shadow-[var(--shadow-panel)]">
    <div className="flex items-start justify-between gap-4"><div className="flex items-center gap-2"><Icon size={16} className="text-[var(--primary)]"/><h2 className="text-sm font-semibold">{title}</h2></div><span className="rounded-md bg-[var(--success-soft)] px-2 py-1 text-[9px] font-semibold text-[var(--success)]">{status}</span></div>
    <div className="mt-2 text-xs text-[var(--muted-foreground)]">{meta}</div>
    <div className="mt-4"><div className="text-[9px] font-semibold tracking-[.12em] text-[var(--text-faint)]">CAPABILITIES</div><div className="mt-2 flex flex-wrap gap-1.5">{capabilities.map(item => <span key={item} className="rounded-md border border-[var(--border-soft)] bg-[var(--background)]/25 px-2 py-1 text-[10px] text-[var(--muted-foreground)]">✓ {item}</span>)}</div></div>
    <Link to={to} className={btnSecondary + ' mt-4'}>查看详情</Link>
  </article>;
}

export default function Integrations() {
  const [counts,setCounts] = useState({cdn:0,dns:0,keys:0});
  async function load() {
    const [cdn,dns,keys] = await Promise.all([
      api.get('/cdn-channels').catch(() => []),
      api.get('/dns-records').catch(() => []),
      api.get('/auth-keys').catch(() => [])
    ]);
    setCounts({cdn:Array.isArray(cdn)?cdn.length:0,dns:Array.isArray(dns)?dns.length:0,keys:Array.isArray(keys)?keys.length:0});
  }
  usePolling(load,15000);

  return <div>
    <div className="mb-5"><div className="text-[10px] font-semibold tracking-[.16em] text-[var(--primary)]">INTEGRATIONS</div><h1 className="mt-1 text-2xl font-semibold tracking-[-.03em]">平台与外部能力</h1><p className="mt-1 text-xs text-[var(--muted-foreground)]">Provider、CDN、DNS 与凭据统一从这里进入；Workspace 只消费这里真实可用的 Capability。</p></div>
    <div className="grid gap-3 xl:grid-cols-2">
      <Card icon={Cloud} title="网宿 CDN" status="CONFIGURED" meta={counts.cdn + ' Channels'} capabilities={['RTMP Push','Origin Pull','Channel state']} to="/cdn-channels"/>
      <Card icon={Globe2} title="DNS" status="AVAILABLE" meta={counts.dns + ' Managed records'} capabilities={['Domain records','Provider sync']} to="/dns-records"/>
      <Card icon={FileKey2} title="凭据与访问控制" status="AVAILABLE" meta={counts.keys + ' Credential records'} capabilities={['Provider credential','Ingest credential','Access grant']} to="/auth-keys"/>
      <Card icon={Network} title="Provider 认证" status="CONFIGURABLE" meta="网宿 / 阿里云等外部账户" capabilities={['Wangsu API','Aliyun DNS']} to="/wangsu-auth"/>
    </div>
  </div>;
}
