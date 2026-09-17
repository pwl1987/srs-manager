export const CURRENT_VERSION = '0.3.0';

export const RELEASES = [
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
