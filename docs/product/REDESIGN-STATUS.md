# SRS Manager 整改状态

本文件是产品整改的阶段状态入口，用于跨窗口恢复真实进度。代码、测试、CI 和真实部署证据与本文件不一致时，以真实实现与验证结果为准并及时更新本文件。

## 当前阶段

**Workspace V2 / W2-A：直播业务工作台信息架构与低疲劳灰阶视觉正在收口。**

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

- 后端回归测试当前 19/19 通过；
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
3. W2-C：**CURRENT** — 管理员安全预览授权、本地音频电平、运行时细节与输出交互收口；
4. W2-D：最终真实 SRS 回归、响应式/可用性检查与发布收口。

`/forwarding` 与 `/monitor` 暂保留兼容路由，但不再作为正常工作流主入口。转码模板作为全局资源保留，具体挂载在 Stream Workspace 完成。

### W2-B 真实媒体证据（10.30.5.199）

- 真实源流 `22`：1920×1080 H.264 + AAC；
- 同一 Transcode Pipeline 同时生成 `1080P + 720P + audio-only` 三条派生流，三条均被 SRS Observed；
- `ffprobe` 实际读取确认：1080P/720P 为 H.264+AAC，audio-only 仅 AAC；
- Worker 重启后 Desired RUNNING 自动恢复，三条派生重新进入 Runtime RUNNING；
- 单独停止 audio-only 会重建 Pipeline，audio 派生消失，1080P/720P 自动恢复；
- 2 核现场主机三路并发测试期间 FFmpeg 峰值约 1.24 CPU 核，测试结束后临时绑定、模板与派生流全部清理；
- 数据库升级/清理前后 `integrity_check=ok`，历史单模板只迁移为 STOPPED binding，不会升级后自动启动。

W2-A 当前实现：灰阶主题与导航收敛已完成；Workspace 首屏已改为内嵌预览、实时指标、真实 SRS 媒体证据和“采集 → SRS → 处理/转码 → 输出分发”业务路径；IN-PULL 来源登记与 OUT-PUSH 目标创建已内聚到当前流。旧 `streams.transcode_template_id` 只作为迁移记录展示，不再声称存在真实转码 Runtime。

## 下一任务

继续 W2-C：在不削弱 OUT-PULL 鉴权的前提下完成管理员短时预览授权，并补本地双声道音频电平与运行态细节。

## 验证债务

- v0.4.1 运行修复已部署 10.30.5.199：允许受管媒体使用 RFC1918/ULA，兼容 SRS 6 opaque client/stream id，19/19 现场回归通过；
- W2-C 管理员内嵌预览需要独立短时授权，不能通过关闭 OUT-PULL Grant 策略绕过；
- Workspace V2 完成后重新跑真实 IN-PUSH / IN-PULL / OUT-PUSH / OUT-PULL 媒体证据；
- 管理员 HLS 预览在 Require Grant 场景下仍需短时内部授权，不能通过关闭鉴权绕过。
