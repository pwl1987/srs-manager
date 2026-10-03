# SRS Manager 版本更新记录

本文件记录用户能够感知到的产品能力、运维机制、界面体验和重要工程变化。版本记录以“现在能做什么”为核心，不把纯代码重构包装成功能更新。

## 未发布 — v0.6.x 稳定维护

> 口径说明：以下条目均为 main 工作区**未提交候选**（基线 `987efeb`）中的改动；FIX-01/FIX-02/FIX-03/FIX-04/FIX-05/FIX-06 为候选内的六次复核修订过程，无中间提交。

- **Phase 09-FIX-06 复核修订（SERVE 持久 generation / 删除重建 tombstone 修正）**：修复一个确定的生命周期缺口——FIX-05 的 generation 存放在可删除的 `out_pull_policies` 行内，`key-A 创建（generation=1）→ 删除 policy → 新 key-B 以相同配置重建（generation 又从 1 开始）→ 迟到的 key-A 重放` 会错误恢复 200 重放资格。现在版本权威迁至按房间持久的 `serve_policy_revisions` 表（`(epoch, generation)`），**删除 policy 行不再重置版本空间**：epoch 在删除后重建时递增（新实例身份）、generation 跨全部历史严格递增永不回绕；幂等 mapping 同时钉住第一次结果的 epoch 与 generation 且不可变。重放判定升级为双权威：policy 行不存在 → 409 `RESULT_GONE`；实例（epoch）已变化——旧结果已被删除并由新实例替代，即使字段完全相同 → 409 `RESULT_GONE`（tombstone 不复活）；同实例内 generation 前进 → 409 `RESULT_SUPERSEDED`；两者相同 → 200 纯读重放。无法证明 epoch/revision 的历史 mapping（pre-FIX-05 与 FIX-05 两种形状）一律 fail-closed。幂等迁移测试重写为真 pre-upgrade 夹具（升级前建立旧形状表与真实存量行，require 当前迁移后断言真实 ALTER 结果），废止「迁移后插入 + 手工置 NULL」冒充升级证据。新增 F1–F4 删除重建对抗回归（同配置删建不复活且零写、异配置绝不采纳、最新键纯读且身份钉住、两轮删建版本不回绕）。

- **Phase 09-FIX-05 复核修订（SERVE 幂等 ABA 生命周期修正）**：修复一个确定的幂等语义缺口——旧版 SERVE 重放只比较「当前配置是否与第一次结果字段相同」，`key-A 创建 A → key-B 改为 B → key-C 改回与 A 完全相同` 后，迟到的 key-A 会错误恢复 200 重放资格（ABA 问题）。现在 `out_pull_policies` 携带单调递增 `generation`：每次真实控制面写入（新 key 的 SERVE 配置、serve 启动/停止、V2 policy 路由）都在 UPSERT 内基于数据库当前值原子 +1（不依赖秒级粒度的 `updated_at` 充当版本）；幂等 mapping 记录创建时的 `result_revision` 并保持不可变。重放判定改为 generation 权威：policy 行不存在 → 409 `RESULT_GONE`；generation 已前进 → 409 `RESULT_SUPERSEDED`（字段偶然回到相同不再恢复资格，只有最后一次真实写入对应的 key 持有当前 generation）；generation 相同 → 200 纯读重放，零写副作用。迁移后的旧 SERVE mapping（无 generation 证据）一律 fail-closed 拒绝重放，绝不猜测恢复。回归覆盖 ABA 重配、启停循环、立即纯读、最新键持有 generation、legacy 迁移 fail-closed 五类场景。

- **Phase 09-FIX-04 复核修订（输出幂等与创建意图完整性；含同日 idempotency lifecycle correction）**：`POST /v3/rooms/:id/outputs` 支持服务端 `Idempotency-Key` 真幂等——fingerprint 由服务端按规范化请求计算（PUSH 含 target_url、RECORD 含 format/storage、SERVE 含 transports/防护）。幂等状态机冻结为：同键同请求 → 200 纯读重放（零写副作用，SERVE 不再重写 policy）；同键异请求 → 409 CONFLICT 且原资源不变；**已创建主体被删除 → 409 RESULT_GONE（键保留为 tombstone、永不改绑，重建必须换新键，禁止旧键复活已删除输出）**；**SERVE 单例被后续配置/启停取代 → 409 RESULT_SUPERSEDED（迟到旧键不得回滚新配置）**；「是否首次创建」的判定、资源创建与键映射在同一 `BEGIN IMMEDIATE` 写事务内（跨进程并发由写锁串行化，键映射无 update 路径；双进程真实并发回归锁定同 room + 同键只产生一个资源/一条映射/同一 canonical output id）。幂等证据只存 SHA-256 指纹与主体引用，含凭据的 payload 明文永不落库。创建 journal 为每个输出持有稳定幂等键，响应丢失后同键重放即恢复，原「按 name+mode+scene 猜 workspace 输出」的弱采纳路径整体删除（同名异 target_url/format 的旧输出不可能被误认），输出恢复不再依赖 workspace 读取。创建意图首次提交即冻结为快照：部分失败后修改表单（房间名/方向/源地址/输出目标）不会嫁接到旧 journal 已创建的资源上；向导首次提交后表单与步骤即锁定，失败后只能「重试未完成步骤」或「放弃本次创建并新建」——放弃时明确提示已创建的服务器资源不会被自动删除，**新事务使用全新幂等键、绝不继承被放弃 journal 的输出键**。真实服务器丢响应故障矩阵扩至 18 行（PUSH/RECORD/SERVE 纯读重放 + abandon 全新键行 + 四条负向：同名异 target_url 不采纳、同名异 format/storage 不采纳、同键异请求 409、丢响应且 workspace 全丢纯键恢复）。
- **Phase 09-FIX-03 复核修订（创建 journal 响应丢失恢复硬化）**：新建向导创建链在「服务端已成功、客户端响应丢失」场景下全面可恢复——Session 创建响应丢失或重试 409 时按 room + run plan + title + PREP/READY 生命周期精确采纳既有会话（不再在 preflight 前永久卡死，数据库最终只有一个 Session，重试只继续 preflight；不匹配的 active session 按真实冲突上报，绝不误采纳）；Run Plan 对账从仅按名称升级为完整 fingerprint（名称 + 节目源 + 输出列表 + failover；`run_plans.name` 数据库层不唯一，同名异构方案永不被采纳）；输出与 Run Plan 重试时先按 fingerprint 对账再创建（服务端对这两类资源无去重，关闭重复资源制造窗口）；新增真实服务器「响应丢失故障矩阵」集成测试覆盖创建链全部八步（真实路由 + 真实数据库 + 真实前端 journal，后续新增 creation step 必须补进矩阵）。

- **Phase 09-FIX-02 复核修订（凭据与安全二次收口）**：新建向导 IN_PUSH 凭据请求带上确定性 label（`wizard-<房间名>`，缺失即拒绝发请求；后端对空 label 的 400 契约已由集成测试锁定，修复真实创建必 400 的缺陷）；一次性凭据生命周期闭合——关闭/取消/进入工作台后明文即从向导状态清除，重开必为新 journal，同场失败重试不清除，不落 localStorage/sessionStorage；ffmpeg/ffprobe 选择 fail-closed（绝对路径 allowlist 之外一律 null：worker 进入终态 FAILED、预监上报不可用，杜绝裸名 PATH 回退；污染 PATH 下伪造二进制不会被解析或执行，含真实子进程终态验证）；external-sources 投影同时剥离 `idempotency_key`（幂等重放仅靠客户端自持键 + POST）；向导改用专用 `wizard` 尺寸 `min(1180px,96vw)`（1280×720 / 1366×768 / 1440×900 / 1920×1080 四档实测无横向溢出，含凭据完成页与预检阻断视图）；e2e 冒烟客户端增加反向 SSRF 控制（仅 http(s) + 环回/RFC1918，目标经 `scripts/e2e-target.json` 配置）；部署脚本不再把生成的管理员密码复制进第二个 shell 变量、硬化脚本子进程改由环境文件整体继承凭据。
- **安全（GATE-UNBLOCK，Mimosa direct high 12→4→0）**：record/pull/push/transcode 四个 worker 与预监服务的 ffmpeg/ffprobe 可执行程序不再从环境变量选择，且不再有裸名 PATH 回退（详见 `docs/security/MIMOSA-GATE-UNBLOCK.md`：本地 `scan --fail-on high` 与 `audit` 均 exit 0，deep 封印扫描 direct findings 0）。
- **Phase 09-FIX-01 复核修订（向导与安全收口）**：新建向导 IN_PUSH 流程真实发放一次性推流凭据（明文仅在创建响应、完成视图一次性展示；重试先采纳已发放的 ACTIVE 凭据，绝不二次发放，响应丢失时提示吊销重发而非重新暴露令牌）；IN_PULL 节目源改用 `pull_task_sources.id` 精确映射（禁止与 `external_sources.id` 混用，夹具三者互异）；`POST /api/external-sources` 支持 `Idempotency-Key` 幂等重放（唯一部分索引 + 迁移测试），丢失响应后同键重放即对账，原始拉流地址不再回流浏览器；向导输出场景语义一律取自 `GET /v3/output/scenes`（PARTNER_PULL=rtmp/http-flv + access-grant），三场景创建有真实集成测试；预检独立成 journal 步骤（BLOCKED 以 409 完整评估体呈现具体阻断数，重试只重跑预检）；右栏"结束本场直播"补齐与完整工作台一致的确认弹窗（共享 closeSession 命令）。
- **Phase 09 主入口与向导收口（P1 第一开发包）**：直播资源主入口重排为「列表 + 右侧值守面板」——顶部全局搜索（NFKC 规范化 + 原串高亮）、四向方向筛选（含本地输出）、四桶状态筛选（运行中/需关注/故障/未运行）与手动刷新；选中直播间后在右栏完成确认状态、安全预监（含 L/R RMS 电平）与高频生命周期操作（预检/开播/收播），≥1440 常驻、<1440 抽屉，双击/键盘/按钮均可进入完整工作台。四向文案（第三方推给我们/我们主动拉第三方/我们推给第三方/第三方拉我们的输出）与状态四色口径（绿=正常运行、黄=需关注/等待、红=故障、灰=未运行）由 directions/room-presentation 纯投影统一，统计卡、筛选、行状态与右栏同源。
- **向导式新建直播间**：五步向导（基本信息 → 输入方向 → 输入源配置 → 输出配置 → 预检与运行）替换两字段弹窗；支持零输出"纯输入监看型"直播间；多步提交带 creation journal——失败后仅重试未完成步骤，stream 按唯一名称对账，external source 按 Idempotency-Key 重放对账，output 按服务端返回 ID / fingerprint 对账，绝不从头重放。
- **streams 身份字段**：新增备注（remark）与业务归属（business_unit），`PUT /api/streams/:id` 支持字段级部分更新（absent=保持、null/空串=清空、其他 trim+校验，上限 200 字符）；`GET /api/v3/rooms` 摘要新增 room_summary 方向事实（inputs.kinds、push_total 计入 srs_dynamic、serve_configured 区分 serve_enabled、configured_total），配置事实与运行事实彻底分离，契约版本 `workspace-v3-phase00.1` 不变。
- **缺陷修复**：直播资源页创建成功后误报"创建直播间失败"（残留 load() 引用）与 ErrorBanner 重试崩溃已修复；flv.js 预监生产构建崩溃由统一适配层（强制主线程转封装）修复并补齐回归测试。
- 前端 V3 触及组件（直播资源主入口、值守面板、输入源架、输出架、会话命令条、新建向导）文案全量迁入 i18n（zh-CN/en-US 双语，键位奇偶校验通过）。
- 仓库开发 Authority 收敛为唯一 `main`，禁止 force push / 分支删除，管理员同样受 required checks 约束；
- CI 强制执行 Backend Tests、Frontend Build、Static Analysis、Container Build、Delta Coverage、Contract Tests 六项门禁；Diff 可执行行覆盖率必须 ≥85%，整体覆盖率相对主线下降不得超过 0.5 个百分点；
- API 实现变更必须同步真实集成测试，禁止仅以纯 Mock 单测替代；
- 前端测试基础升级到 Vitest 4.1.11，并将 high/critical `npm audit` 纳入静态扫描；
- ECharts 5.6.0 → 6.1.0，新增 Monitor 使用 API 兼容测试，production build 通过，npm audit 清零；
- 默认隐藏原始 SRS `:8080` HLS/HTTP-FLV Origin URL，旧 Monitor/二维码/无 CDN fallback 不再自动绕过 Manager Preview Proxy；新增 systemd Origin 硬化脚本与外部暴露探针，将 `1985/8080` 的生产网络边界纳入 Field Gate；
- SRS API 客户端增加 Bearer/Basic 双栈认证：当前生产 SRS 6.0.191 使用 Basic，硬化脚本同步迁移持久化 `srs_api_url` 到 loopback，并使后续 systemd release preflight 能在 API 鉴权后继续检测活动流；systemd release 依赖门禁改为比较完整生产依赖闭包，允许仅 dev/test 依赖变化复用既有生产 `node_modules`，运行时依赖一旦漂移仍直接拒绝部署。

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
