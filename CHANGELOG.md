# SRS Manager 版本更新记录

本文件记录用户能够感知到的产品能力、运维机制、界面体验和重要工程变化。版本记录以“现在能做什么”为核心，不把纯代码重构包装成功能更新。

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

## 后续版本方向

接下来优先完成：

1. OUT-PUSH 运行态与 Desired / Runtime / Observed 分离；
2. OUT-PULL Access Grant 与播放授权控制；
3. Live Event / Template / Preflight；
4. 告警、Operation 时间线、Reconciler 与 Audit；
5. Runbook、批量操作和自动化策略；
6. 真实部署环境下的端到端媒体链路验收。
