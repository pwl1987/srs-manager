# SRS Manager 整改状态

本文件是产品整改的阶段状态入口，用于跨窗口恢复真实进度。代码、测试、CI 和真实部署证据与本文件不一致时，以真实实现与验证结果为准并及时更新本文件。

## 当前阶段

**Workspace V3：UI-00、Phase 00–08 全部 COMPLETE，Phase 08 Field Gate 已 PASS；当前为 v0.6.0 release candidate，Current Task 是正式生产 systemd 升级、post-deploy smoke 与 GitHub Release 收口。v0.5.1 继续作为已验证回退基线。**

## 已完成

### P0 — 产品与四向流控制模型

已完成：

- IN-PUSH / IN-PULL / OUT-PUSH / OUT-PULL 四向链路定义；
- 输入所有权与输出控制边界；
- 期望状态、运行状态、观测状态分离原则；
- 业务流图与联动基线；
- 危险操作进入 Operation 状态机的原则。

### P1 — 界面框架与运营中心第一轮

已完成：

- 分组导航、Header、宽屏工作区和设计变量；
- 运营中心重构；
- 通用面板、空状态、错误状态、搜索和确认组件；
- v0.3.0 增加科技感背景、玻璃层次、版本标识和 MVP 快捷入口。

### P2 — 单流工作台

已完成：

- `/streams/:id` 单流工作台；
- 输入、输出、CDN、分发、播放地址和活动记录聚合；
- 真实观测、已配置、不可用三类证据语义；
- 发布端/播放端精确控制；
- 工作台聚合 API。

### P3-A — Managed Pull 最小运行时

已完成：

- PullTask 期望状态与运行状态；
- 独立 Pull Worker + FFmpeg；
- 退避重试、启动超时和失败状态；
- 输入所有权冲突检测；
- Worker 心跳与单执行者 Lease；
- Web 与 Pull Worker 双镜像；
- 来源 URL 普通 API / 日志脱敏；
- 工作台 Start / Stop / Retry / Unbind；
- Node 24 + `better-sqlite3` N-API 兼容基线。

### P3-B — 主备拉流与安全切源

已完成：

- 一个 PullTask 对应多个候选来源；
- 来源优先级、启用状态和当前活动来源；
- 旧单来源任务自动兼容为优先级 1；
- 同一来源连续失败达到门槛后自动向后备来源切换；
- 默认不自动回主源，避免直播期间抖动；
- 来源集合 API；
- 工作台展示活动源、备用源、优先级、启用状态与最近切换原因；
- 活动来源删除事务化，失败不会留下半修改状态；
- 人工安全切源 Operation：QUEUED → STOPPING → STARTING → VERIFYING → SUCCEEDED / FAILED；
- 切源采用 break-before-make，旧 Publisher 未消失时不会启动新源；
- Worker 重启后可安全恢复未完成切源；
- 用户停止拉流会取消进行中的切源 Operation。


### P3-C — 主动外推与第三方拉流控制

代码层已完成：

- OUT-PUSH 从配置型 Dynamic Forward 升级为独立 Push Worker + FFmpeg 受管运行时；
- OUT-PUSH 支持 Desired / Runtime 分离、WAITING_INPUT、Start / Stop / Retry、退避与独立 Worker Lease；
- 停止 OUT-PUSH 会真正终止本地 FFmpeg，不再只是修改 enabled 字段；
- Managed Worker 任务不会再被 Dynamic Forward backend 返回，避免同一路目标双推；
- OUT-PULL 新增 Endpoint Enabled、Accept New Sessions、Require Grant 三类准入策略；
- Access Grant 只保存 SHA-256 哈希，明文 token 仅创建时返回一次；
- on_play Hook 已接入真实准入判断，无效授权返回非零 code；
- 吊销授权与断开当前会话保持独立语义；
- 内部媒体凭证由共享 SQLite 原子生成，保证 Push Worker 不被外部播放策略误拦；
- Stream Workspace 已接入 Managed Push 与 OUT-PULL 控制面。

### 工程门禁

已完成：

- 后端回归测试当前 64/64 通过；Workspace V3 Contract、Adapter、Evidence/Operation、Source/Program、Unified Output 与 RECORD 回归均保持全绿；
- 前端生产构建与多语言 key 校验通过；
- v0.3.0 Web / Pull Worker 镜像及 FFmpeg 发布门禁已通过；
- v0.4.0 Compose 已包含 Web / Pull Worker / Push Worker 三服务并通过模型校验；
- `b998538` 后端、前端、容器三条 GitHub CI 全部通过；
- 不依赖真实 SRS 的控制面 smoke 9/9 通过，可用于部署后快速验收；
- v0.3.0 起 CI 按变更范围触发，容器重任务只在关键变更、版本发布或人工触发时执行；
- 同分支重复 CI 自动取消旧任务，降低 GitHub Actions 用量。

## 当前任务

### Workspace V2 — 直播业务工作台

当前从“技术对象汇总页”转向“单路直播完整工作站”。设计基线见 `STREAM-WORKSPACE-V0.2.md`。

执行顺序：

1. W2-A：**COMPLETE** — 灰阶视觉、导航收敛、采集 → SRS → 转码 → 输出的信息架构；
2. W2-B：**COMPLETE** — 一条流多转码模板挂载 + 单 Pipeline Transcode Worker + Desired/Runtime/Observed；
3. W2-C：**COMPLETE** — Manager 同源安全预览代理、本地双声道 RMS dBFS 电平、内部会话不计观众；
4. W2-D：**COMPLETE** — 四向真实媒体回归、响应式/可用性审计、过期入口/文案与版本发布收口。

`/forwarding` 与 `/monitor` 暂保留兼容路由，但不再作为正常工作流主入口。转码模板作为全局资源保留，具体挂载在 Stream Workspace 完成。

### W2-B 真实媒体证据（10.30.5.199）

- 真实源流 `22`：1920×1080 H.264 + AAC；
- 同一 Transcode Pipeline 同时生成 `1080P + 720P + audio-only` 三条派生流，三条均被 SRS Observed；
- `ffprobe` 实际读取确认：1080P/720P 为 H.264+AAC，audio-only 仅 AAC；
- Worker 重启后 Desired RUNNING 自动恢复，三条派生重新进入 Runtime RUNNING；
- 单独停止 audio-only 会重建 Pipeline，audio 派生消失，1080P/720P 自动恢复；
- 2 核现场主机三路并发测试期间 FFmpeg 峰值约 1.24 CPU 核，测试结束后临时绑定、模板与派生流全部清理；
- 数据库升级/清理前后 `integrity_check=ok`，历史单模板只迁移为 STOPPED binding，不会升级后自动启动。

### W2-C 安全预览真实证据（10.30.5.199）

- SRS 6 现场确认：`8080/live/*.m3u8` 不经过现有 `on_play` 准入链路，且响应无 CORS；因此不再声称 OUT-PULL Hook 策略覆盖直连 HLS；
- 管理员预览改为 `Browser → SRS Manager:3001 → SRS Origin:8080` 同源受保护代理，不通过关闭对外鉴权换取监看；
- Preview Token 默认 10 分钟、绑定单个 stream id/name，只能读取该流同名 playlist 与该流前缀分片；缺 Token、错流 Token 和跨流资源均拒绝；
- 主清单、二级 media playlist、TS 分片都由 Manager 重写为 3001 同源 URL，浏览器不暴露 Origin 主机地址；
- 现场业务流 `22`：无 Token=403，受保护主/二级清单=200，TS=200，并通过 Manager:3001 Preview Proxy 被 `ffprobe` 实际读取为 1920×1080 H.264 + 48kHz 双声道 AAC；预览不计入外部观众；
- 额外合成 640×360 H.264 + AAC 48kHz 测试流，经 3001 Preview Proxy 被 `ffprobe` 实际读取成功，测试流随后自动清理；
- 浏览器电平使用当前预览媒体的 L/R RMS dBFS，明确标记为本地监看电平，不冒充 EBU R128/广播响度计。

### W2-D 四向真实媒体回归（10.30.5.199）

- 使用完全隔离的 `w2d_*` 临时流完成闭环，未触碰业务流 `22`；
- IN-PUSH：FFmpeg 合成源真实推入 SRS，Workspace 观测到 opaque Publisher id、H.264 640×360 + AAC；
- IN-PULL：Pull Worker 从同机私网 RTMP 源拉入另一条业务流，Runtime=RUNNING 且 SRS Observed；Stop 后目标流真实消失；
- OUT-PUSH：Push Worker 将源流主动推送到私网 RTMP 目标，Runtime=RUNNING 且目标流真实出现；Stop 后目标真实消失；
- OUT-PULL：Endpoint 关闭时真实 RTMP 播放被拒绝；Require Grant 后有效 token 播放成功；
- 测试完成后 `w2d_* / w2proxy_*` 流、PullTask、PushTask 零残留，数据库 `integrity_check=ok`；
- SRS / Manager / Pull Worker / Push Worker / Transcode Worker 五个现场服务最终均为 active。

W2-A 当前实现：灰阶主题与导航收敛已完成；Workspace 首屏已改为内嵌预览、实时指标、真实 SRS 媒体证据和“采集 → SRS → 处理/转码 → 输出分发”业务路径；IN-PULL 来源登记与 OUT-PUSH 目标创建已内聚到当前流。旧 `streams.transcode_template_id` 只作为迁移记录展示，不再声称存在真实转码 Runtime。

## 下一任务

Workspace V3 设计已冻结。设计 Authority：`STREAM-WORKSPACE-V0.3-DESIGN-FREEZE.md`；UI Authority：`UI-V3-PRODUCT-DESIGN-LAB.md`；实施 Authority：`STREAM-WORKSPACE-V0.3-IMPLEMENTATION-PLAN.md`。

Last Completed：**Phase 08 — 16:9 Cutover / Compatibility Cleanup / Release Gate**。生产 Workspace 代码已切到 V3 16:9 主工作面；1920×1080 五态、1366×768、2560×1440、3840×2160 UI Gate 通过；v0.5.1 数据 additive migration 与旧 backend 回退可读通过；真实 `live` 主机隔离 Candidate 完成 PREP → ON AIR → INCIDENT → RECOVERY → CLOSING → ENDED。Backend `69/69 PASS`、frontend build/i18n PASS、Container Release Gate `35294729038` SUCCESS。

Current Task：**v0.6.0 Release Closure / Production Cutover**。补齐 systemd Record Worker 正式单元与可回退部署脚本，执行正式生产升级、post-deploy health/DB/service/UI smoke，再创建 v0.6.0 tag 与 GitHub Release。

Next Task：**Stable Maintenance / V3.x Backlog**。v0.6.0 正式发布后进入稳定维护；Design Freeze 后的新功能默认进入 V3.x backlog，不回插 Phase 00–08。

## 验证债务 / 已知边界

- 前端依赖审计存在既有 `echarts < 6.1.0` moderate XSS advisory；修复需要 ECharts major upgrade，应作为独立兼容性任务处理，非本轮 `flv.js` 引入；

- SRS 8080 直连 HLS 不受当前 `on_play` Hook 策略保护；若对外暴露 HLS，必须在反向代理/CDN 层增加鉴权与防盗链；
- OUT-PUSH Runtime RUNNING 证明本地受管 FFmpeg 工作且输入在线，不等同于第三方平台已经成功播放；远端健康仍需供应商 API 或独立观测证据；
- 浏览器音频电平是本地预览 RMS dBFS，不是 EBU R128 / LUFS 广播响度计；
- `/forwarding` 与 `/monitor` 继续保留兼容深链接，但不作为正常值守工作流入口。
