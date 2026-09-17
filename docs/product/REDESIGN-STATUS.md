# SRS Manager 整改状态

本文件是产品整改的阶段状态入口，用于跨窗口恢复真实进度。代码、测试、CI 和真实部署证据与本文件不一致时，以真实实现与验证结果为准并及时更新本文件。

## 当前阶段

**v0.4.0 候选阶段：P3-C 四向链路控制收口。**

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

- 后端回归测试当前 15/15 通过；
- 前端生产构建与多语言 key 校验通过；
- v0.3.0 Web / Pull Worker 镜像及 FFmpeg 发布门禁已通过；
- v0.4.0 本地 Compose 已包含 Web / Pull Worker / Push Worker 三服务并通过模型校验；
- v0.3.0 起 CI 按变更范围触发，容器重任务只在关键变更、版本发布或人工触发时执行；
- 同分支重复 CI 自动取消旧任务，降低 GitHub Actions 用量。

## 当前任务

### v0.4.0 P3-C 发布收口

当前只做收口，不继续扩功能：

1. 完成 OUT-PUSH / OUT-PULL API、Workspace 与中文文档一致性审计；
2. 后端、前端、迁移与 Hook 回归全部通过；
3. Compose / 媒体 Worker 容器门禁通过后发布 v0.4.0；
4. 真实 SRS 环境补一路主动外推、停止外推、播放授权和断会话证据。

## 下一任务

P3-C 收口后进入 P4：

- Live Event / 直播任务；
- 开播前 Preflight：SRS、输入、Push Worker、CDN、DNS、NTP、播放链路；
- Operation 时间线、Alert、Reconciler 与 Audit；
- Runbook、模板、批量操作和自动化策略；
- 继续统一 CDN / DNS / 设置等剩余页面的工作流与视觉语言。

## 验证债务

以下能力已有代码和自动测试，但仍需要真实部署环境证据后才能标记为“运行时验证完成”：

1. 真实 RTMP/SRT/RTSP 来源 → Pull Worker → SRS 的持续拉流；
2. 主源断开 → 连续失败达到门槛 → 自动切备用源；
3. 人工安全切源：旧 Publisher 消失 → 目标来源启动 → 新 Publisher 被确认；
4. Pull Worker 容器重启后的期望状态恢复；
5. 双 Pull Worker 同时存在时只有 Lease Owner 启动 FFmpeg；
6. Web 重启不影响正在运行的 Pull Worker；
7. 长时间运行下 SQLite WAL、心跳、Operation 和流状态保持一致；
8. 真实输入 → Push Worker → 第三方 RTMP/SRT 目标持续外推；
9. OUT-PUSH Stop 后第三方接收端立即断流，输入消失后任务进入 WAITING_INPUT；
10. SRS Origin 在开放、暂停新连接、需要 Grant、关闭端点四种策略下的真实播放行为；
11. 吊销 Grant 与“断开当前会话”分别取得实际媒体证据。

## 当前完成度估计

按阶段复杂度和风险权重估算，整体整改约完成 **75%**。

v0.3.0 已完成输入侧 MVP；v0.4.0 候选版已经补齐 OUT-PUSH 与 OUT-PULL 的代码控制面。剩余工作主要集中在真实部署证据、直播任务/开播前检查、告警/状态协调/审计与 Runbook 自动化。
