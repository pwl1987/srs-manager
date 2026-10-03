# SRS Manager 整改状态

本文件是产品整改的阶段状态入口，用于跨窗口恢复真实进度。代码、测试、CI 和真实部署证据与本文件不一致时，以真实实现与验证结果为准并及时更新本文件。

## 当前阶段

**Workspace V3：UI-00、Phase 00–08 全部 COMPLETE，Phase 08 Field Gate 与正式生产 systemd cutover 均 PASS；v0.6.0 已正式发布，当前进入 Stable Maintenance / V3.x Backlog。v0.5.1 继续作为已验证回退基线。**

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

- 后端回归测试当前 100/100 通过（Phase 09 候选口径，2026-09-20；Workspace V3 Contract、Adapter、Evidence/Operation、Source/Program、Unified Output 与 RECORD 回归均保持全绿）；
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

Last Completed：**SRS 8080/1985 Origin Exposure Hardening / Field Gate**。应用侧默认不返回原始 SRS `:8080` HLS/HTTP-FLV URL；生产 `live` 已完成硬化，SRS、Manager、Pull/Push/Transcode/Record 六个服务均 active，`1985` 与 `8080` 仅监听 `127.0.0.1`，未授权 SRS API 返回 `401`。外部探针与生产 post-deploy smoke 均 **PASS**。现场 SRS 6.0.191 使用 Basic Auth，客户端和硬化脚本保留 Basic/Bearer 双栈。随后完成的预监/录制输出控制加固（`987efeb`）统一 flv.js 预监走主线程适配层并补齐回归测试。

Current Task：**Phase 09 — Main Entry / Wizard 收口（含 FIX-01/FIX-02/FIX-03/FIX-04/FIX-05/FIX-06 六次复核修订），代码与本地 Final Gate 完成、FIX-06 后代码冻结、待 🔴 核心级评审（2 LGTM，其一 Code Owner）与 199 发版**。事实口径：`HEAD = origin/main = 987efeb`，全部 Phase 09 改动为 main 工作区**未提交候选**（无中间提交 SHA），覆盖率基准仍为 `987efeb`。实施冻结版 v4 FINAL 与 FIX-01…FIX-06 修订见 `contracts/workspace-v3/PHASE-09-MAIN-ENTRY-AND-WIZARD.md`（评审导航见同目录 `PHASE-09-REVIEW-PACKET.md`）。已落地：主入口「列表 + 右侧值守面板」（四向/四桶筛选、NFKC 搜索高亮、手动刷新、≥1440 常驻 / <1440 抽屉）；`directions` / `room-presentation` / `search-text` 纯投影层；五步向导（专用 `wizard` 尺寸 `min(1180px,96vw)`）+ creation journal（可恢复提交、零输出直播间）；streams `remark`/`business_unit`（PUT 部分更新语义）与 room_summary 方向事实。**FIX-01**：IN_PUSH 一次性凭据（明文仅创建响应、重试采纳既有 ACTIVE 不二次发放）；IN_PULL `pull_task_sources.id` 精确映射；external-sources Idempotency-Key 幂等重放；场景语义单一来源 `/v3/output/scenes`；preflight 独立 journal 步骤；右栏收播确认弹窗。**FIX-02**：凭据 label 贯穿（`wizard-<房间名>`，后端 `{}`→400 契约锁定）；一次性凭据生命周期闭合（reducer RESET——关闭/进入工作台后明文不可再现，跨运行防串写，不落 storage）；媒体程序 fail-closed（allowlist 或 null，无裸名 PATH fallback，worker null 时终态 FAILED，污染 PATH 伪造二进制不执行）；`publicSource` 剥离 `idempotency_key`；候选排除 `.zcode/plans` 与 coverage。**FIX-03（creation journal 响应丢失恢复硬化）**：session 创建响应丢失/重试 409 按 room+run plan+title+PREP/READY 精确采纳（消除 preflight 前永久卡死；数据库终态仅 1 个 Session，retry 只继续 preflight；不匹配即真实冲突不误采纳）；run plan 对账升级完整 fingerprint（`run_plans.name` 不唯一——名称+节目源+输出+failover 全等才采纳，同名异构禁止）；output/run-plan 重试先 fingerprint 预对账再创建（服务端对二者无去重，关闭重复资源窗口）；新增真实服务器丢响应故障矩阵 `wizard-lost-response-matrix.integration.test.js`（真实路由+真实 DB+真实前端 journal，后续新增 creation step 必须补进矩阵）；media-bin 定位修正为 allowlist contract authority（跨模块 resolver 会被静态扫描判命令注入高危，探针实证）。**FIX-04（output 幂等与 creation intent 完整性，含同日 lifecycle correction）**：`POST /v3/rooms/:id/outputs` 支持 `Idempotency-Key` 服务端真幂等（fingerprint 按规范化请求计算并覆盖 PUSH target_url / RECORD format+storage / SERVE transports+防护；同键同请求 200 纯读重放，同键异请求 409 且原资源不变；已删除主体同键 409 RESULT_GONE——mapping 保留为 tombstone 永不改绑、重建必须新键；SERVE singleton 被后续写入取代后旧键 409 RESULT_SUPERSEDED 且零写副作用；「是否首次」判定与资源创建、键映射同在 `BEGIN IMMEDIATE` 事务内，双进程并发终态资源 1 / mapping 1 / 同一 canonical output id；证据只存 SHA-256 指纹+主体引用，含凭据 payload 明文永不落库）；journal 每个 output index 持有稳定幂等键，丢响应后同键重放即恢复——原 name+mode+scene workspace 弱采纳路径整体删除，输出恢复不依赖 workspace 读取；creation intent 首次提交冻结为 `creation_intent_snapshot`（retry 只重放快照，改 form 不嫁接旧 journal 资源）；向导首次 submit 后表单/步骤锁定，失败后仅「重试未完成步骤」或「放弃本次创建并新建」（放弃明确提示已创建资源不自动删除，新事务全新幂等键零继承）。**FIX-05（SERVE generation / ABA lifecycle correction）**：修复确定性 ABA 缺口——旧版 SERVE 重放只比字段，`key-A:A → key-B:B → key-C:A` 后迟到 key-A 错误恢复 replay 资格；generation 单调递增、全部控制面写入经 `updatePolicy()` 原子 +1（禁止秒级 `updated_at` 充当版本），mapping 记录首次写入的 `result_revision` 且不可变；重放 generation 权威（行不存在 RESULT_GONE / generation 前进 RESULT_SUPERSEDED——字段偶然回到相同不恢复资格 / generation 相同 200 纯读零写），legacy 无证据 mapping fail-closed；A/B/C/D/E 回归。**FIX-06（SERVE persistent generation / delete-recreate tombstone correction，2026-09-21）**：修复确定性 delete/recreate 复活缺口——FIX-05 的 generation 在可删除的 policy 行内，`key-A 创建 → 删除 policy → 新 key-B 同配置重建（generation 从 1 重来）→ 迟到 key-A 拿回 200 replay`；版本权威迁至按房间持久的 `serve_policy_revisions` 表 `(epoch, generation)`（删除 policy 行不重置；epoch 删除后重建时递增=新实例、generation 跨全部历史严格递增不回绕；分配与写入同事务，嵌套为 savepoint）；`out_pull_policies.epoch` 携带实例身份、`output_idempotency.result_epoch` 让 mapping 钉住 `(epoch, generation)` 且不可变；重放双权威：行不存在或 **epoch 已变化（旧结果已被删除并由新实例替代，字段相同也不行）→ RESULT_GONE（tombstone 不复活）**、同实例 generation 前进 → RESULT_SUPERSEDED、两者相同 → 200 纯读零写；`result_revision` 或 `result_epoch` 任一 NULL（pre-FIX-05 与 FIX-05 两种旧形状）一律 fail-closed；幂等迁移测试重写为**真 pre-upgrade 夹具**（升级前建旧形状表+真实存量行→require 迁移→断言真实 ALTER 结果；废止「迁移后插入+手工置 NULL」冒充升级证据）；F1–F4 删除重建对抗回归（同配置删建 key-A 永久 GONE 零写不改绑、异配置绝不采纳、最新键纯读且身份钉住、两轮删建版本不回绕）。Mimosa direct high 时间线 **12→4→0→0→0**（`scan --fail-on high` 与 `audit` 均 exit 0，deep 封印 direct 0；处置记录 `docs/security/MIMOSA-GATE-UNBLOCK.md`；会话内 L3 commit hook 经最小复现定性为 ZCode 会话工具限制，非项目 Gate failure）。Final Gate（2026-09-21，FIX-06 后全量重跑）：backend `145/145`（矩阵 18/18 + output-idempotency 集成 21/21 含 ABA 四条与 F1–F4 四条 + 双进程竞争 2/2 + 幂等迁移 4/4 真 pre-upgrade 夹具）、frontend `141/141`、intent freeze `32/32`、check-i18n（957 键）、production build（10.94s）、phase08 8/8、双侧 npm audit 0、contract/指名批次 `62/62`、`git diff --check` 干净、**Diff Coverage 86.18%（1409/1635，backend 96.11% · frontend 80.16%）≥85% PASS**（沿用 FIX-05 起声明的可复现严格口径，未切换算法；上一轮 88.92%/95.60% 历史数字出自已删除临时脚本，仅存档）、全量语句覆盖 backend **66.82% vs 56.28%（+10.54pp）**、frontend 行覆盖 **34.89% vs 16.97%（+17.92pp）**（基线经独立 worktree 于 987efeb 实测复跑 81/81 + 15/15 全绿）、Mimosa `scan --fail-on high` 与 `audit` 均 exit 0（0 高危 direct，77 跨文件污点为 advisory）、`audit --deep` direct 0（[深度] 0/0/0）。4 验收视口无横向溢出（playwright 真实构建页，含凭据完成页与 preflight-BLOCKED 视图，FIX-02 验收继续有效）。rooms-overview 参考截图已按真实实现重生成。**状态更新（2026-10-02）**：Phase 09 冻结候选已提交至分支 `phase-09-main-entry-wizard`（commit `91ca1d8`，78 文件 +9051/−453），PR #1 已创建（https://github.com/pwl1987/srs-manager/pull/1）。CI 六项必需检查中 5 项 PR 关联检查全过（Backend / Frontend / Static / Delta Coverage / Contract）；Container Build 因 PR 未触碰 Docker 文件未自动触发（已手动 workflow_dispatch 通过，但未关联 PR）；CodeQL check 为 pre-existing 仓库级配置损坏（404、5s 即失败，不在必需列表）。**待办**：① 评审（2 LGTM，其一 Code Owner）——当前仓库无其他协作者，需先添加评审人；② 199 发版走 `scripts/deploy-systemd-release.sh` immutable release；③ 发版时执行真实节目源 HTTP-FLV smoke（flv 信号③）；④ 合并前解决 Container Build PR 关联与 CodeQL 配置问题。

Next Task：**OUT-PUSH Remote Verification**。完成 HLS 暴露边界后，为第三方平台成功播放补充供应商 API 或独立观测证据，不把本地 FFmpeg RUNNING 冒充远端成功。

## 验证债务 / 已知边界

- Origin 暴露 Field Gate 已闭合：生产端口仅 loopback，外部 `8080/1985` 探针均 PASS；后续若变更 SRS/systemd/防火墙，必须重新执行本地硬化复核与外部探针；
- 当前生产数据库没有 `forward_tasks`、网宿认证、网宿频道或任何 OUT-PUSH 目标，因此尚未执行第三方远端播放验证；OUT-PUSH Runtime RUNNING 仍不等同于第三方平台成功播放，后续必须取得供应商 API 或独立观测证据，不得补写假证据；
- 浏览器音频电平是本地预览 RMS dBFS，不是 EBU R128 / LUFS 广播响度计；
- `/forwarding` 与 `/monitor` 继续保留兼容深链接，但不作为正常值守工作流入口。
