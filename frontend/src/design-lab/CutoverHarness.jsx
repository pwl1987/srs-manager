import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import WorkspaceControlSurfaceV3 from '../components/streams/WorkspaceControlSurfaceV3';

function output(id, name, mode, state, extra = {}) {
  return {
    id, name, mode, desired_state: state === 'STOPPED' ? 'STOPPED' : 'RUNNING',
    runtime_state: state, control_mode: 'MANAGED',
    media_ref: extra.media_ref || 'rendition:room:1:program-original',
    transport: extra.transport || null, format: extra.format || null,
    scene: extra.scene || null, endpoints: extra.endpoints || null,
    evidence: {
      local: { state, source: mode === 'RECORD' ? 'Record Worker' : 'Managed Runtime', freshness: 'FRESH', observed_at: new Date().toISOString() },
      remote: extra.remote || { state: 'UNKNOWN', source: null, freshness: 'UNKNOWN' }
    },
    asset: extra.asset || null
  };
}

export default function CutoverHarness() {
  const [params] = useSearchParams();
  const { t } = useTranslation(['streams','common']);
  const state=(params.get('state') || 'onair').toLowerCase();
  const preview=state === 'preview';
  const incident=state === 'incident';
  const closing=state === 'closing';
  const prep=state === 'prep';

  const data=useMemo(() => {
    const pushState=incident ? 'FAILED' : closing ? 'STOPPED' : prep ? 'STOPPED' : 'RUNNING';
    const recordState=closing ? 'FINALIZING' : prep ? 'STOPPED' : 'RECORDING';
    const outputs=[
      output('output:push:1','视频号','PUSH',pushState,{transport:'rtmp',scene:'LIVE_PLATFORM_PUSH',media_ref:'rendition:room:1:binding-1'}),
      output('output:serve:1','网宿 CDN','SERVE',closing ? 'STOPPED' : prep ? 'STOPPED' : 'AVAILABLE',{scene:'CDN_ORIGIN',endpoints:[{transport:'http-flv',protection:'access-grant',advertised:true},{transport:'hls',protection:'external-proxy',advertised:true}]}),
      output('output:push:2','合作方 A','PUSH',closing ? 'STOPPED' : prep ? 'STOPPED' : 'RUNNING',{transport:'srt',scene:'SRT_NODE',media_ref:'rendition:room:1:binding-2'}),
      output('output:record:1','本地录像','RECORD',recordState,{format:'mp4',asset:{state:closing?'FINALIZING':'ACTIVE',size_bytes:19500000000,duration_seconds:6151}})
    ];
    const sessionOutputs=outputs.map((item,index) => ({output_ref:item.id,importance:index < 3 ? 'REQUIRED':'OPTIONAL'}));
    const session={
      legacy_session_id:1, run_plan_id:1, title:'晚间新闻直播',
      lifecycle_state:closing?'CLOSING':prep?'PREP':'ON_AIR',
      preflight_status:prep?'WARNING':'PASS',
      plan_snapshot:{name:'晚间新闻标准方案'},
      started_at:prep?null:new Date(Date.now()-9698000).toISOString(),
      outputs:sessionOutputs
    };
    const v3={
      room:{id:'room:1',legacy_stream_id:1,name:'晚间新闻'},
      session,
      sources:[
        {id:'source:in_push:main',kind:'IN_PUSH',name:'主编码器',role:'PROGRAM',availability:'ONLINE',protocol:'rtmp',compatibility:{kind:'ingest_credential'}},
        {id:'source:in_pull:backup',kind:'IN_PULL',name:'备编码器',role:'STANDBY',availability:'UNKNOWN',protocol:'rtmp',compatibility:{enabled:true,desired_state:'STOPPED'}},
        {id:'source:in_pull:srt',kind:'IN_PULL',name:'SRT Backup',role:'STANDBY',availability:'UNKNOWN',protocol:'srt',compatibility:{enabled:true,desired_state:'STOPPED'}},
        {id:'source:in_pull:phone',kind:'IN_PULL',name:'记者手机',role:'OFFLINE',availability:'OFFLINE',protocol:'rtmp',compatibility:{enabled:false}}
      ],
      program:{id:'program:room:1',source_id:'source:in_push:main',state:'LIVE',attribution:'IN_PUSH_CONFIGURED',evidence:{freshness:'FRESH'}},
      renditions:[
        {id:'rendition:room:1:program-original',kind:'PASSTHROUGH',runtime_state:'RUNNING'},
        {id:'rendition:room:1:binding-1',kind:'TRANSCODE',media_profile_id:'media-profile:1080',desired_state:'RUNNING',runtime_state:'RUNNING',observed:{online:true}},
        {id:'rendition:room:1:binding-2',kind:'TRANSCODE',media_profile_id:'media-profile:720',desired_state:'RUNNING',runtime_state:'RUNNING',observed:{online:true}}
      ],
      outputs,
      health:{status:incident?'DEGRADED':'NORMAL',reasons:incident?[{code:'OUTPUT_RUNTIME_FAILED'}]:[]},
      evidence:{workers:{pull:{available:true,instance_id:'pull-1'},push:{available:true,instance_id:'push-1'},transcode:{available:true,instance_id:'tc-1'},record:{available:true,instance_id:'rec-1'}}},
      capabilities:{runtime:{record:{available:true,storage:{low_space:false}}}},
      timeline:[{type:'PROGRAM_OBSERVED',occurred_at:new Date().toISOString()}],
      operations:closing?[{id:'operation:close',type:'V3_SESSION_CLOSE',phase:'VERIFYING',step:'RECORD'}]:[]
    };
    const observed={
      online:true,bitrate:8100,uptime_seconds:9698,players:{count:18},
      media:{video:{codec:'H.264',width:1920,height:1080,profile:'High'},audio:{codec:'AAC',sample_rate:48000,channels:2}},
      publisher:{ip:'10.30.5.80',protocol:'rtmp'}
    };
    const incidents=incident ? {active:[{id:1,severity:'CRITICAL',status:'OPEN',title:'视频号输出中断',message:'RTMP connection reset',impact:{program_affected:false,output_ids:['output:push:1'],can_still_broadcast:true,suggested_action:'Retry only the affected Output and leave healthy Outputs running.'}}],recent:[]} : {active:[],recent:[]};
    return {v3,observed,incidents};
  },[prep,incident,closing]);

  return <div className="h-screen overflow-hidden bg-[var(--background)] text-[var(--foreground)]">
    <WorkspaceControlSurfaceV3
      stream={{id:1,name:'晚间新闻'}}
      observed={data.observed}
      media={data.observed.media}
      v3Workspace={data.v3}
      sourcePreview={preview ? {source_id:'source:in_pull:backup',source_name:'备编码器'} : null}
      outputScenes={[]}
      incidentState={data.incidents}
      sourceDrawerContent={<div className="text-sm text-[var(--muted-foreground)]">Source configuration drawer</div>}
      advancedDrawerContent={<div className="text-sm text-[var(--muted-foreground)]">Advanced engineering drawer</div>}
      onPreviewSource={() => {}}
      onQr={() => {}}
      onChanged={async () => {}}
      t={t}
      readOnlyHarness
    />
  </div>;
}
