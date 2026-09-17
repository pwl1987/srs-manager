export const rooms = [
  {
    id: 1, name: '晚间新闻', state: 'ON AIR', health: 'NORMAL', session: '02:41:38',
    program: '主编码器', input: 'Protected · 2 Standby', outputs: '4/4 Required Healthy',
    recording: 'REC · 18.6 GB', incident: null,
  },
  {
    id: 2, name: '新闻发布会', state: 'ON AIR', health: 'DEGRADED', session: '00:58:12',
    program: '演播室编码器', input: 'Protected · 1 Standby', outputs: '3/4 Required Healthy',
    recording: 'REC · 7.1 GB', incident: '视频号输出中断 · RETRYING 2/5',
  },
  {
    id: 3, name: '政务直播间', state: 'OFF AIR', health: 'OFF AIR', session: '--:--:--',
    program: '未选择', input: '1 Source Ready', outputs: '3 Configured', recording: 'Stopped', incident: null,
  },
  {
    id: 4, name: '应急直播间', state: 'OFF AIR', health: 'OFF AIR', session: '--:--:--',
    program: 'SRT 专线', input: 'Protected · 1 Standby', outputs: '2 Configured', recording: 'Stopped', incident: null,
  },
];

export const sources = [
  { name: '主编码器', role: 'PROGRAM', protocol: 'RTMP PUSH', state: 'LIVE', meta: 'H.264 · AAC · 8.1M', uptime: '00:42:18' },
  { name: '备编码器', role: 'STANDBY', protocol: 'RTMP PUSH', state: 'READY', meta: '1080P25 · 8.0M', uptime: 'Ready' },
  { name: 'SRT 备源', role: 'STANDBY', protocol: 'SRT PULL', state: 'READY', meta: '1080P25 · 7.8M', uptime: 'Ready' },
  { name: '记者手机', role: 'OFFLINE', protocol: 'RTMP PUSH', state: 'OFFLINE', meta: '等待推流', uptime: '--' },
];
export const outputs = [
  { name: '视频号', group: 'PRIMARY', media: '1080P', route: 'RTMP PUSH', state: 'LIVE', evidence: '5.8 Mbps · LOCAL', remote: 'Unknown' },
  { name: '网宿 CDN', group: 'PRIMARY', media: '1080P', route: 'SERVE · HLS/FLV', state: 'LIVE', evidence: '428 viewers', remote: 'Verified' },
  { name: '官网 CDN', group: 'PRIMARY', media: '1080P', route: 'SERVE · HLS', state: 'LIVE', evidence: '216 viewers', remote: 'Verified' },
  { name: '合作方 A', group: 'PARTNERS', media: '720P', route: 'SRT PUSH', state: 'LIVE', evidence: '3.1 Mbps · LOCAL', remote: 'Unknown' },
  { name: '本地录像', group: 'RECORDING', media: '1080P', route: 'MP4 RECORD', state: 'REC', evidence: '01:42:31 · 18.6 GB', remote: 'Local file growing' },
];

export const profiles = [
  { name: '1080P Broadcast', type: 'VIDEO+AUDIO', video: 'H.264 · 1920×1080 · 25fps · 6 Mbps · GOP 2s', audio: 'AAC · 48kHz · 192k', usage: '4 Outputs' },
  { name: '720P Distribution', type: 'VIDEO+AUDIO', video: 'H.264 · 1280×720 · 25fps · 3 Mbps · GOP 2s', audio: 'AAC · 48kHz · 128k', usage: '2 Outputs' },
  { name: 'Audio Broadcast', type: 'AUDIO', video: 'No video', audio: 'AAC · 48kHz · 192k · Stereo', usage: '1 Output' },
  { name: 'Program Passthrough', type: 'PASSTHROUGH', video: 'Keep source video', audio: 'Keep source audio', usage: '2 Outputs' },
];

export const runPlans = [
  { name: '晚间新闻标准方案', program: '主编码器', required: ['官网 CDN', '网宿 CDN', '本地录像'], optional: ['视频号', '合作方 A'], failover: '主编码器 → 备编码器 → SRT 备源' },
  { name: '发布会标准方案', program: '演播室编码器', required: ['网宿 CDN', '本地录像'], optional: ['视频号'], failover: '演播室编码器 → SRT 备源' },
];

export const incidents = [
  { severity: 'CRITICAL', room: '新闻发布会', title: '视频号输出失败', impact: '1 Required Output', duration: '02:13', state: 'RETRYING 2/5' },
  { severity: 'WARNING', room: '晚间新闻', title: '备用 SRT Source unavailable', impact: '当前 Program 不受影响', duration: '11:42', state: 'ACKNOWLEDGED' },
];
