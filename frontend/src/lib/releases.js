export const CURRENT_VERSION = '0.5.1';

export const RELEASES = [
  {
    version: '0.5.1',
    date: '2026-09-17',
    stage: { zh: '安全收口', en: 'Security Hotfix' },
    title: { zh: '预览代理安全加固', en: 'Preview Proxy Hardening' },
    summary: {
      zh: '在 Workspace V2 基线上进一步收紧管理员预览凭据与跨流资源边界，并补齐真实 Origin 代理回归。',
      en: 'Tightens operator preview credentials and cross-stream resource isolation on top of Workspace V2, with stronger origin-proxy regression coverage.'
    },
    highlights: {
      zh: [
        '管理员 Preview Token 默认有效期收紧为 10 分钟。',
        'Preview Proxy 继续严格绑定 stream id/name，只允许当前流 playlist 与同前缀分片。',
        '代理测试改为真实本地 HLS Origin，覆盖两级 playlist、TS、无 Token、错流 Token 与跨流资源拒绝。',
        '10.30.5.199 真实业务流 22 经 Manager:3001 代理被 ffprobe 识别为 1920×1080 H.264 + 48kHz 双声道 AAC。'
      ],
      en: [
        'Reduced the default operator Preview Token lifetime to 10 minutes.',
        'Preview Proxy remains bound to one stream id/name and only permits that stream playlist and segment namespace.',
        'Replaced mocked proxy coverage with a real local HLS origin covering nested playlists, TS, missing token, wrong-stream token and cross-stream rejection.',
        'Verified stream 22 through Manager:3001 with ffprobe as 1920×1080 H.264 plus 48 kHz stereo AAC.'
      ]
    }
  },
  {
    version: '0.5.0',
    date: '2026-09-17',
    stage: { zh: '直播工作台 V2', en: 'Stream Workspace V2' },
    title: { zh: '单流直播工作站', en: 'Per-stream Operations Workstation' },
    summary: {
      zh: '把采集、SRS 原始流、多路转码、输出分发、鉴权和实时监看收进同一直播工作台，并补齐真实 Transcode Worker 与安全预览代理。',
      en: 'Unifies acquisition, SRS source evidence, multi-rendition transcoding, distribution, access control and monitoring in one per-stream workstation.'
    },
    highlights: {
      zh: [
        '灰阶播控视觉降低长时间值守的黑白强对比疲劳。',
        '业务信号路径重构为采集 → SRS 原始流 → 处理/转码 → 输出分发。',
        '新增 Transcode Worker，同一源流一个 FFmpeg Pipeline 可同时生成 1080P、720P、纯音频等派生流。',
        '多转码支持 GOP/keyint、Desired / Runtime / Observed 分离，并经过真实 SRS 媒体验证。',
        '管理员 HLS 预览改走 Manager 同源短时受保护代理，并增加本地 L/R RMS dBFS 电平。',
        '内部 Worker 读流不再误计为观众，断开观众也不会误踢内部媒体会话。',
        'OUT-PULL 明确 Hook 与直连 HLS 安全边界，不再生成无效 HLS 授权链接。'
      ],
      en: [
        'Introduced a lower-fatigue neutral gray broadcast-console visual system.',
        'Reframed the signal path as acquisition → SRS source → processing/transcode → distribution.',
        'Added a Transcode Worker where one FFmpeg pipeline can generate 1080p, 720p, audio-only and custom renditions.',
        'Added GOP/keyint control plus Desired / Runtime / Observed semantics with real SRS media verification.',
        'Moved operator HLS preview behind a short-lived same-origin Manager proxy with local L/R RMS dBFS metering.',
        'Internal worker playback no longer inflates viewer counts or gets disconnected by viewer controls.',
        'Clarified the Hook-versus-direct-HLS security boundary and removed misleading HLS grant URLs.'
      ]
    }
  },
  {
    version: '0.4.0',
    date: '2026-09-17',
    stage: { zh: '四向链路控制', en: 'Four-way Flow Control' },
    title: { zh: '主动外推与拉流授权', en: 'Managed Push & Pull Access' },
    summary: {
      zh: '补齐输出方向的真实控制面：主动外推由 Push Worker 管理，第三方拉流可分别控制端点、新连接、授权和当前会话。',
      en: 'Completes the output-side control plane with a managed Push Worker and independent endpoint, session-admission and access-grant controls.'
    },
    highlights: {
      zh: [
        '新增独立 Push Worker + FFmpeg，OUT-PUSH 可以真正启动、停止、重试。',
        '没有输入时进入 WAITING_INPUT，输入消失会主动停止外推进程。',
        '新增独立 Push Worker Lease，防止多个执行器重复外推。',
        '新增 OUT-PULL Endpoint / Accept New Sessions / Require Grant 三类策略。',
        'Access Grant 只存 token 哈希，明文只在创建时返回一次。',
        'SRS on_play Hook 已接入真实播放准入，吊销授权与断当前会话保持独立。',
        'v0.3 旧 Forward 数据可无损迁移，Managed Worker 与 Dynamic Forward 不会双推。'
      ],
      en: [
        'Added a dedicated Push Worker + FFmpeg runtime with real start, stop and retry controls.',
        'OUT-PUSH waits for local input and stops the outbound process when input disappears.',
        'Added an independent Push Worker lease to prevent duplicate execution.',
        'Added OUT-PULL endpoint, new-session admission and grant-required policies.',
        'Access grants store only token hashes; plaintext is returned once at creation.',
        'SRS on_play now enforces playback admission while grant revocation and current-session disconnect remain separate actions.',
        'v0.3 Forward rows migrate safely and managed tasks cannot be duplicated by Dynamic Forward.'
      ]
    }
  },
  {
    version: '0.3.0',
    date: '2026-09-17',
    stage: { zh: 'MVP', en: 'MVP' },
    title: { zh: '推拉流可用版', en: 'Push / Pull MVP' },
    summary: {
      zh: '把 SRS Manager 从配置型后台推进到真正可值守的直播运维控制台，核心推流、拉流与单流工作台已经形成可用闭环。',
      en: 'Moves SRS Manager from a configuration panel toward an operations console with a usable push, pull and stream-workspace loop.'
    },
    highlights: {
      zh: [
        '推流入口与拉流地址集中到直播流工作区，减少跨页面查找。',
        '上线独立 Pull Worker + FFmpeg，支持外部源拉入 SRS。',
        '支持多候选源、自动故障切换与人工安全切源 Operation。',
        '引入 Worker Lease，避免多 Worker 同时拉取同一路流。',
        '升级 Node 24 / SQLite 运行基线，修复原生清理崩溃问题。',
        'CI 按变更范围触发，容器重任务仅在关键变更、版本发布或人工触发时运行。',
        '新增版本更新中心与中文更新日志。'
      ],
      en: [
        'Centralized publish and playback endpoints in the stream workspace.',
        'Added a dedicated Pull Worker + FFmpeg runtime for ingesting external sources into SRS.',
        'Added source sets, automatic failover and safe manual source-switch operations.',
        'Added Worker Lease ownership to prevent duplicate pull execution.',
        'Updated the Node 24 / SQLite runtime baseline and removed a native cleanup crash.',
        'Reduced CI usage with change-scoped checks and gated container builds.',
        'Added an in-product release center and Chinese changelog.'
      ]
    }
  },
  {
    version: '0.2.0',
    date: '2026-09-17',
    stage: { zh: '工作台重构', en: 'Workspace Redesign' },
    title: { zh: '直播运维工作台', en: 'Operations Workspace' },
    summary: {
      zh: '重做信息架构与 Stream Workspace，把输入、输出、监看和运行状态放回同一条流的工作上下文。',
      en: 'Reworked information architecture and Stream Workspace around the real operating context of each stream.'
    },
    highlights: {
      zh: [
        '重构侧边栏与运营中心，降低一级导航数量与认知负担。',
        '新增 Stream Workspace 聚合视图。',
        '区分配置状态、运行状态与真实观测状态。',
        '补齐精确断开发布端、播放端等控制语义。'
      ],
      en: [
        'Reworked navigation and the operations center.',
        'Added the Stream Workspace aggregate view.',
        'Separated configured, runtime and observed state.',
        'Added scoped publisher and viewer control semantics.'
      ]
    }
  },
  {
    version: '0.1.0',
    date: '2026-09-16',
    stage: { zh: '基础能力', en: 'Foundation' },
    title: { zh: '管理面板基础版', en: 'Management Panel Foundation' },
    summary: {
      zh: '建立流管理、CDN、DNS、转发、鉴权、转码、监控和系统设置等基础管理能力。',
      en: 'Established the management foundation for streams, CDN, DNS, forwarding, credentials, transcode, monitoring and settings.'
    },
    highlights: {
      zh: [
        '完成 React 19 + Vite + Tailwind CSS v4 前端基础。',
        '完成 Node.js + Express + SQLite 后端基础。',
        '接入 SRS、网宿 CDN 与阿里云 DNS 的基础管理能力。'
      ],
      en: [
        'Established the React 19 + Vite + Tailwind CSS v4 frontend.',
        'Established the Node.js + Express + SQLite backend.',
        'Added foundational SRS, Wangsu CDN and Aliyun DNS integrations.'
      ]
    }
  }
];
