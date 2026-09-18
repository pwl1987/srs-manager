# SRS Manager 版本更新记录

本文件记录用户能够感知到的产品能力、运维机制、界面体验和重要工程变化。版本记录以“现在能做什么”为核心，不把纯代码重构包装成功能更新。

## v0.6.0 — Workspace V3 直播运维控制台

发布日期：2026-09-18

### 核心目标

把此前按技术模块分散的直播管理能力收敛成真正的一屏直播运维控制台：长期 Room、一次 Session、Program、共享 Rendition、PUSH / SERVE / RECORD Output、Incident 与 Closing 全部围绕真实值班流程组织。

### 新增与改进

- Workspace 切换为 16:9 播控工作面：顶部 Session Command Bar，左侧 Input Rack，中间 PGM/PVW，右侧 Output Rack，下方 Signal Route 与 Operations Dock；
- Source / Program 模型支持独立 Ingest Credential、Managed Pull 主备与安全切源；切源目标不可用时自动 rollback 旧 Program；
- Program Preview 默认 HTTP-FLV，HLS fallback；备用源按需 PVW，不再用预监画面冒充 Program；
- PUSH / SERVE / RECORD 统一为 Output，场景模式与专业模式共用 Product / Runtime / Destination Capability 校验；
- Canonical Rendition signature 允许多个 Output/Recording 复用同一处理规格，避免重复转码；
- 新增 Record Worker：安全 TS 分段、MP4 finalize、异常 RECOVERABLE、文件增长证据、磁盘剩余可录时长与共享 Rendition 复用；
- 新增 Session / Run Plan / Preflight，区分 Required / Optional，支持幂等开播和局部成功；
- 新增 Incident 影响链、ACK ≠ RECOVERED、恢复时间线，以及按网络输出 → Record Finalize → Pull → Program 的安全 Closing 编排；
- 旧 `/forwarding`、`/monitor` 与旧 Runtime 控制仍作为兼容深链/Advanced 保留，不再作为正常工作流。

### Phase 08 发布证据

- Backend 回归：69/69 PASS；前端 i18n / production build PASS；
- 1920×1080 五态以及 1366×768、2560×1440、3840×2160 布局 Gate 通过；
- GitHub Container Release Gate `35294729038` 在 `b0c74af` 成功，Web / Pull / Push / Transcode / Record Worker 均通过；
- 真实 v0.5.1 SQLite 副本执行 additive migration 后，旧表/旧列/旧数据 SHA-256 100% 保持；旧版 backend 可直接读取升级后的数据库；
- `live` 主机隔离候选完成 PREP → ON AIR → INCIDENT → RECOVERY → CLOSING → ENDED，Required PUSH 与 MP4 RECORD 均有真实媒体/文件证据；
- 正式 systemd cutover 在安全窗口完成，备份目录 `/home/ubuntu/srs-manager-backups/20260918T023052Z`；事务内 post-deploy smoke 与独立复核均 PASS，六服务 active、DB integrity `ok`、Manager / SPA HTTP 200、Record heartbeat fresh；
- SRS 直连 HLS 仍是独立安全边界；Managed PUSH 的本地 RUNNING/Observed 不冒充第三方 Remote Verified。

## v0.5.1 — Workspace V2 安全收口

发布日期：2026-09-17

- 管理员 Preview Token 默认有效期从 30 分钟收紧为 10 分钟；
- Preview Proxy 继续强制绑定单个 stream id/name，跨流 playlist / TS 资源拒绝访问；
- 代理回归测试改为真实本地 HLS Origin，覆盖两级 playlist、TS、无 Token、错流 Token 与跨流资源；
- `10.30.5.199` 真实业务流 `22` 已通过 Manager:3001 Preview Proxy，被 `ffprobe` 识别为 1920×1080 H.264 + 48kHz 双声道 AAC；
- 不改变 v0.5.0 的业务模型和 UI，只做安全与发布一致性收口。

## v0.5.0 — 直播工作台 V2

发布日期：2026-09-17

### 核心目标

把直播值守从“多个资源页面来回跳转”收敛到**一条流一个业务工作站**：采集、SRS 原始流、多路转码、输出分发、鉴权和实时监看都在 `/streams/:id` 完成。

### 新增与改进

- 灰阶播控视觉：背景从近黑抬升为中性深灰，正文使用柔和浅灰，降低长时间值守的黑白强对比疲劳；
- 业务信号路径重构为「采集 → SRS 原始流 → 处理/转码 → 输出分发」，技术枚举退居辅助标签；
- 新增 `stream_transcode_bindings` 与独立 Transcode Worker，一条源流一个 FFmpeg Pipeline，可同时挂载 1080P、720P、纯音频和自定义派生流；
- 转码支持 GOP/keyint、分辨率、帧率、视频/音频码率等模板参数，并严格区分 Desired / Runtime / Observed；
- 管理员 HLS 预览改为 Manager:3001 同源受保护代理，Preview Token 短时且绑定单流，主/二级 playlist 与分片全部重写；
- 工作台增加本地 L/R RMS dBFS 音频电平，明确不是 EBU R128 广播响度计；
- 内部 Push/Transcode 读流不再误计为观众，“断开观众”不会误踢内部媒体会话；
- OUT-PULL 安全边界纠正：RTMP/HTTP-FLV 等 `on_play` 路径可用 Hook Grant；SRS 8080 直连 HLS 不再被错误描述为受该策略保护；
- OUT-PULL 签发后不再生成无效的 HLS `access_token` 地址，只生成已验证的 RTMP / HTTP-FLV 授权地址；
- 正常导航移除独立“转发路由 / 实时监看”，兼容路由继续保留，日常操作回到直播工作台。

### 真实验证

- 后端自动回归：27/27 通过；前端 production build 与中英文 key 校验通过；
- `10.30.5.199` 真实 1080P H.264/AAC 源流同时生成 1080P、720P、纯音频三路派生流，SRS Observed 与 `ffprobe` 均通过；
- Transcode Worker 重启后 Desired RUNNING 自动恢复；单独停止纯音频后该派生真实消失，1080P/720P 自动恢复；
- Manager Preview Proxy：无 Token=403，主清单/二级清单/TS 均可受保护读取，预览前后业务观众数保持不变；
- 合成 640×360 H.264 + AAC 流经 3001 Preview Proxy 被 `ffprobe` 实际读取成功；
- 数据库迁移与测试清理前后 `PRAGMA integrity_check=ok`。

## v0.4.0 — 四向链路控制

发布日期：2026-09-17

### 核心目标

在 v0.3.0 “能推入、能拉入”的基础上，把输出方向也升级为真正可控：**我方主动外推可以真启动/真停止，第三方拉流可以分别控制端点、新连接、访问授权和现有会话。**

### 新增

- 新增独立 Push Worker + FFmpeg Managed OUT-PUSH 运行时；
- OUT-PUSH 增加 `STOPPED / WAITING_INPUT / STARTING / RUNNING / RETRYING / FAILED / STOPPING` 运行状态；
- OUT-PUSH 增加 Start / Stop / Retry 和独立 Worker Lease；
- 输入不存在时 OUT-PUSH 进入 `WAITING_INPUT`，输入恢复后再启动；
- 输入消失或用户 Stop 时真正终止本地 FFmpeg 外推进程；
- 新增 OUT-PULL 端点可用、新连接准入和 Require Grant 策略；
- 新增 Access Grant，token 只在创建时返回一次，数据库只保存 SHA-256 哈希；
- SRS `on_play` Hook 接入真实播放准入；
- 新增系统内部媒体凭证，使受管 Push Worker 不受外部播放授权策略误伤；
- 单流工作台增加「主动外推」和「第三方拉流」控制面。

### 兼容与安全

- v0.3 旧 `forward_tasks` 自动迁移到 Managed Worker 模型并保留启停意图；
- SRS Dynamic Forward POST 返回格式与当前 backend 契约对齐；
- Managed Worker 任务不会由 Dynamic Forward 再次返回，避免双推；
- OUT-PUSH 目标地址普通 API 默认脱敏；
- 吊销 Grant 不会冒充“当前连接已断开”，断开会话仍是独立动作；
- OUT-PULL 授权目前只对 SRS Origin 直连入口负责，第三方 CDN 需要供应商侧独立鉴权。

### 验证

- 后端自动回归：15/15 通过；
- v0.3 → v0.4 旧库迁移测试：通过；
- SRS Dynamic Forward POST 兼容与防双推测试：通过；
- on_play 授权拒绝/放行测试：通过；
- 前端生产构建与中英文 key 校验：通过；
- Web / Pull Worker / Push Worker 容器发布检查：通过；
- 当前 API 契约控制面冒烟：9/9 通过（登录、建流、密钥脱敏、IN-PULL、OUT-PUSH、Workspace、OUT-PULL 授权/吊销与策略恢复）；
- 真实媒体环境的 OUT-PUSH 与 OUT-PULL 端到端证据仍作为部署现场验收项。

## v0.3.0 — 推拉流 MVP

发布日期：2026-09-17

### 核心目标

形成第一版真正可用的直播输入闭环：**第三方可以推流到 SRS，系统也可以主动从外部源拉流到 SRS，并能在单流工作台观察和控制。**

### 新增

- 运营中心增加「我要推流 / 我要拉流」MVP 快捷入口；
- 新增独立 Pull Worker + FFmpeg Managed Pull 运行时；
- PullTask 支持多个候选来源、优先级和当前活动来源；
- 主源连续失败达到门槛后可自动切换备用源；
- 新增人工安全切源 Operation：排队、停止旧源、等待旧 Publisher 消失、启动目标源、验证新 Publisher、成功/失败收口；
- 新增 Worker Lease，避免两个 Worker 同时拉同一路业务流；
- 新增产品内「版本更新」页面；
- 新增仓库中文 `CHANGELOG.md`。

### 改进

- Stream Workspace 展示 Managed Pull 的真实 Runtime、Worker、候选源、Active/Standby 和最近切换原因；
- 外部来源 URL 在普通 API 与日志中默认脱敏；
- Active Source 删除改为事务化操作，失败不会留下半修改状态；
- Node 24 下升级 `better-sqlite3` 到 N-API 版本，解决旧原生模块退出时的 cleanup assertion；
- CI 按目录和变更类型触发，容器构建不再被每次前后端提交触发；
- 同分支 CI 使用 concurrency 自动取消过时任务；
- UI 增加更完整的科技感背景、玻璃层次、版本标识和高价值操作入口。

### 当前验证状态

- 后端回归测试：9/9 通过；
- 前端生产构建与多语言校验：通过；
- Web / Pull Worker 容器与 FFmpeg 门禁：此前阶段已通过；
- 仍需在真实部署环境补齐「主源断开 → 自动切备」与「人工切源」的媒体链路证据。

## v0.2.0 — 直播运维工作台

发布日期：2026-09-17

### 新增与改进

- 重构运营中心、分组导航、Header 与设计 Token；
- 新增 Stream Workspace，把输入、输出、CDN、分发、监看与事件放回同一业务上下文；
- 区分配置状态、运行状态与真实观测状态；
- 补齐发布端、播放端精确控制语义；
- 开始从资源 CRUD 后台向直播运维控制台演进。

## v0.1.0 — 基础管理版

发布日期：2026-09-16

### 初始能力

- React 19 + Vite + Tailwind CSS v4 前端；
- Node.js + Express + SQLite WAL 后端；
- 直播流、网宿 CDN、阿里云 DNS、转发任务、鉴权密钥、分发申请、转码模板和监控等基础管理能力；
- Docker / Docker Compose 部署；
- JWT + Refresh Token + bcrypt 基础认证。

## 后续维护原则

当前小项目默认进入**稳定维护 / 现场验收 / bugfix**模式。除非出现明确业务需求，不继续加入 Live Event、复杂告警、Reconciler、Runbook 等大型平台能力；新增功能必须继续遵守“配置不冒充运行、运行不冒充观测”的证据原则。
