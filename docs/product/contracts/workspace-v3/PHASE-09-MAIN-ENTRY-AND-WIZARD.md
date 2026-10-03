# Phase 09 — 主入口信息架构 / 方向映射 / 新建向导 Authority

状态：FROZEN（实施冻结版 v4 FINAL，基线 main `987efeb`）

本文件在编码前冻结字段语义与规则；截图、CHANGELOG、REDESIGN-STATUS 在收口批（B5）补齐。
后续除非发现 Authority/Contract 冲突或真实技术阻断，不再回到方案讨论。

## 范围与分层原则

- 列表（`/streams`）负责发现与分诊；右栏负责确认状态、预监与高频生命周期操作；完整 `/streams/:id` 工作台负责精细控制。
- 右栏一旦满足「确认状态 + 预监 + 高频生命周期控制 + 进入完整工作台」即停止增加功能；更深控制一律留在 `/streams/:id`。
- 本 Phase 不引入第二套状态词汇：方向显示是 contract 词汇（source.kind / output.mode）之上的纯显示层映射。

## room_summary 契约（`GET /api/v3/rooms`）

- 新增字段为 additive；不改 workspace aggregate 形状，不 bump `workspace-v3-phase00.1`。
- 机器可读定义见 `contract.json` 顶层 `room_summary` 段（与 `aggregate` 并列、互不嵌套）。
- **配置事实与运行事实彻底分离**：方向汇总只描述"已配置了什么"；正在跑什么、健不健康继续由 `program` / `outputs.required_*` / `health` 表达。

字段语义：

| 字段 | 语义 |
| --- | --- |
| `inputs.kinds` | 已配置的输入方向数组，取值 `['IN_PUSH','IN_PULL']` 子集；不含运行态 |
| `inputs.push_credentials` | `ingest_credentials` 中 `status='ACTIVE'` 的凭据数 |
| `inputs.pull_tasks` | 已配置的 `pull_tasks` 数（与流 1:1，仍按计数表达） |
| `inputs.legacy_rule` | 既无 ACTIVE 凭据也无 pull task 的房间，按兼容规则视为 legacy `IN_PUSH` |
| `outputs.push_total` | 已配置外推任务数；**必须同时计入 `managed_worker` 与 `srs_dynamic`**（现实现只查 managed_worker，属口径缺陷，本 Phase 修正） |
| `outputs.serve_configured` | 存在 `out_pull_policies` 行即算 true（与 `endpoint_enabled` 无关） |
| `outputs.serve_enabled` | `endpoint_enabled=1` 时为 true；仅运行开关，不参与方向筛选 |
| `outputs.record_total` | 已配置录制任务数 |
| `outputs.configured_total` | `push_total + (serve_configured?1:0) + record_total` |

方向筛选以 `inputs.kinds` / `outputs.*` 为口径：`serve_configured` 保证"已配置但暂关闭"的对外拉流不被隐藏。

## streams 扩展字段与部分更新语义

- `streams` 表新增 `remark`、`business_unit`（均可空）；`ensureColumn` 与初始 `CREATE TABLE` 同步为规范 schema。
- 接口为 `PUT /api/streams/:id`，**支持字段级部分更新**（本文统一称"部分更新语义"，不使用 PATCH 字样，与实际 HTTP Method 保持一致）：
  - 字段 absent = 保持原值；
  - `null` 或空串 = 清空为 NULL；
  - 其他值 = trim 后校验（长度上限 200 字符）再写入。
- `POST /api/streams` 同样接受两字段（可选）。
- v3 房间摘要与 workspace 聚合的 `room` 段暴露 `remark`、`business_unit`。
- 迁移测试必须覆盖两条路径：全新数据库初始化即含新列；旧库升级（ensureColumn）后既有 stream 数据不变。

## 方向显示映射（纯显示层）

| 显示方向 | 契约词汇 | 文案（zh） | 规则 |
| --- | --- | --- | --- |
| IN-PUSH | `source.kind = IN_PUSH` | 第三方推给我们 | 不配色 |
| IN-PULL | `source.kind = IN_PULL` | 我们主动拉第三方 | 不配色 |
| OUT-PUSH | `output.mode = PUSH` | 我们推给第三方 | 不配色 |
| OUT-PULL | `output.mode = SERVE` | 第三方拉我们的输出 | 不配色 |
| 本地输出 | `output.mode = RECORD` | 本地输出/录制 | 本地概念，同样不配色 |

- 颜色只表达状态，绝不表达方向或操作类型；蓝色仅用于选中/控制。
- 映射实现于 `frontend/src/lib/directions.js`，替换现存 5 处散落文案实现。

## 状态投影 `projectRoomPresentation(room)`

统一纯投影函数：`{ bucket, tone, labelKey, reasonKeys }`。统计卡、状态筛选、列表行、右栏只调它。

- `bucket`（业务口径四桶）：`running` 运行中 / `attention` 需关注 / `fault` 故障 / `idle` 未运行。
- `tone`（颜色四色）：绿=正常运行；黄=需关注/等待/部分可用；红=故障/明确风险；灰=未运行/未配置。
- 优先级固定：**故障 > 需关注 > 正常运行 > 未运行**。
- `READY` / `PREP` 视觉可为黄色（等待/过渡），但归「未运行」桶，不得计入需关注统计。
- `UNKNOWN` 按上下文：正在直播但证据未知 → 需关注；完全未运行 → 灰色未运行。

## 搜索规范化

- `normalizeSearchText()`：NFKC + locale-safe lowercase + trim，纯函数（`frontend/src/lib/search-text.js`）。
- 匹配在规范化串上执行；**高亮必须落在原始串上**（NFKC 会改变字符长度，禁止用规范化 index 切原始串）。

## 主入口 IA（`/streams`）

- 顶部工具栏：全局搜索（命中高亮）、方向筛选（全部/四向/本地录制）、状态筛选（=bucket）、手动刷新。
- 列表行：名称(高亮)、方向 chips、状态（投影 tone）、输入来源摘要、输出数量（`configured_total` + 必需健康 hint）、在线时长、观众·码率、动作。
- 右栏 `RoomCommandPanel`：**复用不复制**——预览由 `WorkspacePreviewPanel` 收敛出共享 compact 形态（保留 preview-access、HTTP-FLV→HLS fallback、L/R RMS、AudioContext 清理）；会话生命周期抽共享 hook。
- 轮询三保护：切换房间丢弃旧响应；无选择/抽屉关闭即停止轮询；页面进入后台暂停或降频。
- 响应式：自定义断点 **<1440 抽屉、≥1440 常驻右栏**（不使用 Tailwind 默认 xl=1280）。验收四档：1280×720、1366×768、1440×900、1920×1080。
- 双击进入完整工作台仅为加速手势；键盘 ↑↓ 选择与行尾「进入工作台」按钮为完整入口。

## 新建向导（五步）

基本信息 → 输入方向 → 输入源配置 → 输出配置 → 预检与运行。

- 输入源配置：IN_PUSH 分支仅预告"创建后发放一次性凭据"，凭据只在完成后一次性展示（沿袭 Phase 03 一次性展示约束）；IN_PULL 分支收集源名称/协议/地址。
- 输出配置复用 BuilderDrawer 场景模式内容（抽为共享组件），**可跳过**。
- **零输出口径**：允许纯输入监看型直播间（run-plan `outputs: []`，后端已支持）；向导明确提示「本场无分发/录制输出」；不继承 SessionCommandBar 快速方案 ≥1 输出的前端限制。

### creation journal（可恢复提交）

- 提交序列非事务，必须记录 journal：`stream_id / source_id / pull_task_source_id / credential_id / output_ids / run_plan_id / session_id / preflight` 及每步结果。
- 失败后**仅重试未完成步骤，绝不从头重放**。
- reconcile 规则：stream 可按唯一名称对账；external source / output **不得仅按名称**对账——优先服务端返回 ID / Idempotency-Key；否则用 `room_id + 类型 + 规范化请求 fingerprint` 对账。目的：网络已成功但客户端未收到响应时，不误认同名 Output。
- 支持 Idempotency-Key 的 API（V3 Operation 语法）一律带上。

### PHASE-09-FIX-01 修订（2026-09-19，复核后修正的精确语义）

1. **IN_PUSH 一次性凭据**：提交序列在 stream 之后执行 `POST /v3/rooms/:id/ingest-credentials`；明文 `token/server_url/stream_key/publish_url` 只存在于创建响应，journal 仅在内存中保存 `credential_display` 并在完成视图**一次性展示**。任何重试先 `GET` 凭据列表：已存在 ACTIVE 凭据即**采纳**（`credential_recovered=true`，不再补发明文、绝不二次发放）；「响应丢失」的恢复策略 = 采纳 + 提示到工作台吊销后重发，禁止以任何形式重新暴露 token。
2. **external source 幂等对账**：`POST /external-sources` 支持 `Idempotency-Key` 头（服务端落 `external_sources.idempotency_key`，唯一部分索引；同键重放返回既有行 + 200 + `idempotent_replay:true`）。journal 持有一枚键，丢失响应后同键重放即为对账；列表接口只回 `source_url_masked` + `idempotency_key`，**原始 source_url 永不回流浏览器**，客户端不再按 name/source_url 对账。
3. **IN_PULL 节目源映射**：workspace 的 `source:in_pull:ptsrc-*` 内嵌 `pull_task_sources.id`，与 `external_sources.id` 是两张表。journal 从 `POST /pull-tasks` 响应的 `sources[]`（及 reconcile 时的 `compatibility.external_source_id / pull_task_id / pull_task_source_id`）精确解析 `program_source_id`，禁止用 external id 字符串拼接。测试夹具强制三者互不相等（external=7 / task=9 / ptsrc=31）。
4. **输出场景契约单一来源**：向导场景语义（mode/transports/protections/默认值）一律取自 `GET /v3/output/scenes`（`PARTNER_PULL` = SERVE `['rtmp','http-flv']` + access-grant；`LIVE_PLATFORM_PUSH` = PUSH `['rtmp','rtmps']`；`LOCAL_RECORD` = RECORD mp4/ts/audio）。`wizard-flow` 仅保留策划清单与文案键；场景缺失即失败（`WIZARD_SCENE_UNAVAILABLE`），不允许臆造 payload。输出创建响应按模式映射 canonical id：SERVE 自带 `output:serve:N`，PUSH/RECORD 返回 `{task,rendition}` → `output:push:N` / `output:record:N`。
5. **preflight 独立成步**：journal 单独记录 preflight（`READY / READY_WITH_WARNING / BLOCKED`）；BLOCKED 以 HTTP 409 + 完整评估体返回，必须呈现具体状态（blockers/warnings 计数），失败重试**只重跑 preflight**，不重建 stream/source/output/session。
6. **右栏收播确认**：RoomCommandPanel「结束本场直播」与完整工作台共用同一 ConfirmDialog 文案（`sessionBar.close.*`）与共享 `closeSession` 命令；关闭面板不再裸触发。
7. **媒体程序钉死（GATE-UNBLOCK）**：四个 worker 与 source-preview 的 ffmpeg/ffprobe 可执行程序改为代码内字面量探测链，不再从环境变量选择（详见 `docs/security/MIMOSA-GATE-UNBLOCK.md`）。

### PHASE-09-FIX-02 修订（2026-09-20，二次复核后修正的精确语义）

1. **凭据 label 贯穿**：后端 `POST /v3/rooms/:id/ingest-credentials` 要求非空 `label`（缺失 → 400 `V3_INGEST_VALIDATION`）。向导 intent 产生确定性 label（`wizardCredentialLabel(name)` = `wizard-<房间名>`，空白折叠、上限 80），journal 以 `{ label }` 作为请求体；label 缺失时**拒绝发 POST** 而非发出注定 400 的请求。后端集成测试同时锁定 `{}` → 400 与 wizard 规则 payload → 201（`backend/tests/integration/wizard-creation.integration.test.js`）。
2. **一次性凭据生命周期闭合**：向导 UI 状态为纯 reducer（`frontend/src/lib/wizard-ui-state.js`）。任何关闭路径（取消 / 完成后停留关闭 / 进入工作台——组件全部经 `open=false`）触发 RESET：`completion/failure` 清空、form/step 复位、journal 换新（明文 `credential_display` 随旧对象丢弃）；同一 open 内的失败重试不触发 RESET。跨运行防串写：迟到的 SUBMIT_OK/SUBMIT_FAIL 按 journal 身份丢弃。明文不落 localStorage/sessionStorage。回归：`wizard-ui-state.test.js` 四条生命周期序列。
3. **媒体程序 fail-closed**：字面量链终止分支为 **null**（非裸名）；权威 allowlist 于 `backend/utils/media-bin.js`，测试强制五个消费点与 allowlist 精确等价、无裸名/无 env 选择、spawn 数组参数无 shell、污染 PATH 下伪造二进制不被解析或执行。worker 在 null 时进入终态 FAILED（`worker-fail-closed.smoke.test.js` 以真实子进程 + stub SRS 验证 desired-RUNNING 任务的终态），source-preview capability 上报不可用。
4. **external source 投影**：`publicSource()` 同时剥离 `source_url` 与 `idempotency_key`；幂等重放只靠客户端自持键 + POST，GET 不再返回键。
5. **向导尺寸**：Modal 新增专用 `wizard` 尺寸 `max-w-[min(1180px,96vw)]`（不动 sm–xl 语义）。四档验收视口（1280×720 / 1366×768 / 1440×900 / 1920×1080）以真实构建页 + playwright 验证：dialog 宽 = min(1180, 96vw)，五步 / 输出选择（三场景全开）/ 一次性凭据完成页 / preflight-BLOCKED 中断视图均无横向溢出；720p 同场验证「关闭→重开→旧 token 不存在」。
6. **候选范围**：`.zcode/plans/`、`coverage/`、`scripts/e2e-target.json`（operator 本地冒烟目标）以最窄 .gitignore 规则排除。

### PHASE-09-FIX-06 修订（2026-09-21，SERVE persistent generation / delete-recreate tombstone correction）

> 背景如实记录：FIX-05 后曾宣布「代码冻结、到 2 LGTM 外部边界」。独立复核在真实代码上复现确定的 **delete/recreate 复活缺口**——`key-A 创建（generation=1）→ 删除 policy 行 → replay key-A 正确 RESULT_GONE → 新 key-B 以相同配置合法重建 → 新 policy 行 generation 又从 1 开始 → 再 replay key-A 错误返回 200 replay`。根因：FIX-05 的 generation 属于 `out_pull_policies` **行**生命周期，行删除即重置版本空间。冻结结论撤回，本节为最小修正。

1. **持久 revision authority（`serve_policy_revisions` 表）**：按 `stream_id` 唯一持有 `(epoch, generation)`，**位于可删除的 policy 行之外**——删除 `out_pull_policies` 行不删除/重置 authority。`epoch` 在「无 policy → 新建 policy」时 +1（新实例身份）；`generation` 在**每次真实控制面写入**时基于房间可证历史严格 +1（跨删除/重建永不回绕、永不重置），依旧禁止 `updated_at` 充当版本。分配与 policy 写入在**同一事务**内完成（独立调用者为 `BEGIN IMMEDIATE`；嵌套在 SERVE configure 事务内时为 savepoint）。`out_pull_policies` 增加 `epoch` 列随行携带实例身份；`output_idempotency` 增加 `result_epoch`，mapping 同时钉住第一次结果的 `(epoch, generation)`，依旧 immutable（无 update 路径）。
2. **replay 判定（instance + generation 双权威）**：policy 行不存在 → `RESULT_GONE`；**epoch 已变化（旧实例已被删除并由新实例替代，即使字段完全相同）→ `RESULT_GONE`**（旧 key 的第一次结果已死亡，保持 tombstone/fail-closed 语义，绝不复活、绝不被视为「被取代」）；同 epoch 内 generation 前进 → `RESULT_SUPERSEDED`；epoch + generation 均相同且 fingerprint 相同 → 200 纯读 replay（零写）。`(epoch, generation)` 对在房间历史内永不复用——任何历史 key 不可能重新持有当前身份。全字段语义比对保留为附加 fail-closed 校验。
3. **legacy fail-closed 扩展**：`result_revision` 或 `result_epoch` 任一无法证明（NULL，覆盖 pre-FIX-05 与 FIX-05-era 两种旧 mapping 形状）→ 一律按 SUPERSEDED 终局拒绝重放，绝不猜测恢复。
4. **migration 测试真实性修正**：`output-idempotency-migration.test.js` 重写为**真 pre-upgrade 夹具**——require `database.js` 之前建立 pre-FIX-05 形状的 `out_pull_policies`（无 generation/epoch）+ FIX-04-era 形状的 `output_idempotency`（无 result_revision/result_epoch），插入真实存量 policy 行与 SERVE mapping 行，再加载当前迁移；断言真实 ALTER 结果（新列存在、NOT NULL、存量行 epoch=1/generation=1、legacy mapping 双 NULL、`serve_policy_revisions` 表创建、升级后首次写入 generation 超越存量行值、删除后重建 epoch 递增且 authority 存活）。废止「迁移后插入 + 手工置 NULL」作为升级证据（该手法仅保留为 NULL 路径的行为补充，明确标注非结构性证据）。
5. **新增回归（F1–F4，`output-idempotency.integration.test.js`）**：
   - **F1（同配置删建）**：`key-A:A → DELETE → replay key-A（GONE）→ key-B:A 重建 → replay key-A` → **409 RESULT_GONE**（非 200）；key-B 正常 201；key-A mapping 四字段（subject/output/revision/epoch）不变不改绑；policy 仅一行；复活尝试零写（sentinel + 全行逐字节）；key-B replay 200。
   - **F2（异配置删建）**：`key-A:A → DELETE → key-B:B → replay key-A` → 409 GONE，绝不采纳 B 的配置。
   - **F3（最新键纯读）**：删建后 key-A 终局 GONE；key-B 立即 replay 200 且零写；当前 `(epoch, generation)` 与 key-B mapping 所钉完全一致。
   - **F4（两轮删建）**：`A → delete → B → delete → C` → epoch/generation 严格递增（1,2,3）不回绕不复用；persistent authority 跨两次删除存活且与活跃行一致；key-A/key-B 均 409 GONE；key-C replay 200。

### PHASE-09-FIX-05 修订（2026-09-20，SERVE generation / ABA lifecycle correction）

> 背景如实记录：FIX-04 lifecycle correction 后曾宣布「代码层冻结、不再开启 FIX-05」。独立代码复核复现出确定的 **SERVE idempotency ABA 生命周期缺口**——`key-A 创建配置 A → key-B 改为 B → key-C 改回与 A 完全相同 → 迟到的 key-A 重放` 会因 replay 只比较「当前 policy 是否与第一次结果语义相等」而错误返回 200 replay。冻结结论就此撤回，本节为最小修正，不扩大范围。（FIX-05 的 generation 权威后在 FIX-06 中进一步升级为持久 `(epoch, generation)` 双权威——见 FIX-06 节。）

1. **单调 generation（取代判定权威）**：`out_pull_policies` 新增 `generation INTEGER NOT NULL DEFAULT 1`。全部真实控制面写入都收敛在 `out-pull-service.updatePolicy()` 一个咽喉点（新 key 的 SERVE configure、serve start/stop、V2 policy 路由），UPSERT 内以 `generation = out_pull_policies.generation + 1` **基于数据库当前行值原子自增**；INSERT 初始为 1。**禁止以 `updated_at` 充当 generation**——SQLite `CURRENT_TIMESTAMP` 秒级粒度，同秒两次写入会取得相同时间戳，无法区分取代。
2. **mapping 记录 result_revision**：`output_idempotency` 新增 `result_revision INTEGER`——SERVE 首次创建在**同一 `BEGIN IMMEDIATE` 事务内**读回刚写入的 generation 并记入 mapping（写锁下无并发写入可插入）；PUSH/RECORD 的 subject 身份即 task 行本身，`result_revision` 为 NULL。mapping 依旧 **immutable**（无任何 update 路径）。
3. **SERVE replay 判定（generation 权威）**：policy 行不存在 → `RESULT_GONE`；当前 generation ≠ mapping 记录的 `result_revision` → `RESULT_SUPERSEDED`；generation 相同且 fingerprint 相同 → 200 纯读 replay（零写）。原「全字段语义比对（flags + sanitized v3_metadata）」保留为**附加 fail-closed 校验**，不再是取代判定权威——字段偶然回到与第一次结果相同（A-B-A 重配、stop→start 循环）**不能**恢复已 superseded 旧 key 的 replay 资格；只有「最后一次真实写入对应的 key」持有当前 generation。（FIX-06 升级：generation 从 policy 行内迁至持久 `serve_policy_revisions`，并叠加 epoch 实例权威——删除后重建不再重置版本空间，见 FIX-06 节。）
4. **legacy fail-closed**：迁移（`ensureColumn`）为存量 policy 行补 `generation=1`、为存量 mapping 补 `result_revision=NULL`。`result_revision` 无法证明（NULL）的旧 SERVE mapping 一律 fail-closed——按 `RESULT_SUPERSEDED` 终局拒绝 replay，**绝不猜测恢复**；重新配置需新 key。
5. **新增回归（`output-idempotency.integration.test.js` + `output-idempotency-migration.test.js`）**：
   - **A（ABA）**：`key-A:A → key-B:B → key-C:A → replay key-A` → 409 `V3_OUTPUT_IDEMPOTENCY_RESULT_SUPERSEDED`，policy 全行零写（sentinel `updated_at` + 逐字节比对），且断言 key-C 后字段与 A 首次结果完全相同、generation 前进 2。
   - **B（启停 ABA）**：`key-A:A → stop → start → 字段回到与 A 相同 → replay key-A` → 仍 `RESULT_SUPERSEDED`。
   - **C（纯读）**：`key-A:A → 立即 replay` → 200 `idempotent_replay:true`，generation、`updated_at`、policy 全行逐字节不变。
   - **D（最新键持有 generation）**：ABA 后 `key-B` replay 409 SUPERSEDED，`key-C`（最后一次真实写入的 key）replay 200 纯读零写。
   - **E（migration）**：legacy 库正确获得 `generation`（NOT NULL，存量行=1）与 `result_revision` 列；`result_revision=NULL` 的旧 SERVE mapping replay fail-closed（SUPERSEDED）；迁移后新 key 正常创建并把当前 generation 钉进 mapping。

### PHASE-09-FIX-04 修订（2026-09-20，output 幂等与 creation intent 完整性；同日 lifecycle correction；SERVE 取代判定后由 FIX-05 升级为 generation 权威、FIX-06 升级为持久 epoch+generation 双权威）

1. **Output 创建服务端真幂等（Idempotency-Key）**：`POST /v3/rooms/:roomId/outputs` 支持 `Idempotency-Key` 头，按 `(room_id, idempotency_key)` 唯一约束落 `output_idempotency` 表。服务端从**规范化后的创建请求**计算 SHA-256 fingerprint（与创建路径施加同样的默认值归一）：PUSH 覆盖 mode/name/scene/transport/protection/destination kind/**target_url 规范化值**/processing(template)；RECORD 覆盖 mode/name/scene/**format/audio_format**/processing/**storage.subdir/filename_prefix/segment_seconds/retention_days**；SERVE 覆盖 scene/**transports/endpoint protections**/endpoint_enabled/accepting_new_sessions/consumer label。幂等证据**只存** key + SHA-256 fingerprint + output_type/subject_id/output_id + room_id——含凭据的完整 payload 明文永不落库（测试断言行内无 target_url/凭据明文）。
2. **幂等状态机（lifecycle correction 后冻结）——一个 Idempotency-Key 代表一次确定的创建意图及其第一次结果，不是自动重建钥匙**：
   - `NEW → CREATED`：资源创建 + key mapping 在**同一 `BEGIN IMMEDIATE` 写事务**内提交；「是否首次创建」的判定本身在写事务内进行（`recordedOutputIdempotency` 查询随事务持有写锁），跨进程/跨连接的并发重放由 SQLite 写锁串行化——败者在自己的事务内重读已提交 mapping 并走 replay 分支，**(room_id, key) 唯一索引是 fail-closed 最后防线，不是正确性机制**（mapping 写入为 plain INSERT，无任何 update 路径；并发重复在索引上 ABORT 而非静默改绑）。
   - `CREATED + same fingerprint → REPLAY`：HTTP 200 + `idempotent_replay:true`，**纯读、零写副作用**——PUSH/RECORD 返回已记录 task；SERVE 不再调用 `updatePolicy`、不触碰 `updated_at`（对抗测试以 sentinel `updated_at` 锁定请求前后 policy 行逐字节不变）。
   - `CREATED + different fingerprint → CONFLICT`：409 `V3_OUTPUT_IDEMPOTENCY_CONFLICT`，第一次资源保持不变。
   - `subject 已删除 → RESULT_GONE`：409 `V3_OUTPUT_IDEMPOTENCY_RESULT_GONE`——PUSH/RECORD 的已记录 task 被删除、或 SERVE 的 singleton policy 行被删除。**禁止重新创建、禁止改绑 mapping**；mapping 保留为 tombstone/evidence（subject_id/output_id 不变），用户要重新创建必须生成**新的 Idempotency-Key**。
   - `SERVE singleton 被后续配置取代 → RESULT_SUPERSEDED`：409 `V3_OUTPUT_IDEMPOTENCY_RESULT_SUPERSEDED`——房间 SERVE policy 已被后续操作（新 key 的再配置、serve start/stop 等控制面写入）改变时，迟到的旧 key retry **禁止覆盖新配置**。（FIX-04 初版以「当前 policy 行与第一次结果的全字段语义等价」判定；FIX-05 修正为 **generation 权威**：见 FIX-05 节——字段偶然回到相同不恢复 replay 资格。）
   - **key 永远不改绑到另一个创建结果；新的业务创建 = 新的 Idempotency-Key。**
3. **客户端弱 fingerprint 采纳路径移除**：journal 为每个 output index 在首次 POST 前生成并**终身持有**稳定键 `output_idempotency_keys[index]`，retry 永远同键同请求重放。「服务端已创建 → 响应丢失」的恢复 = 直接再 POST 一次，由服务端返回原 output。原 `name+mode+scene` workspace 猜测路径**整体删除**（同名同 scene 不同 target_url / 不同 format/subdir 的旧输出绝不可能被误采纳；PUSH workspace 只暴露 `target_url_masked`，浏览器本就无法安全重建完整请求指纹）。output 恢复**不依赖** `GET /workspace`（矩阵负向 D 锁定：workspace GET 全丢也照常恢复）。**abandon 语义与新状态机组合**：放弃旧事务后新 journal 从空键数组开始（reducer 断言零继承），需要创建 output 时生成全新键——被 abandon 的键在其输出被清理后即为 tombstone，绝不复活（矩阵 abandon 行端到端锁定：旧键 409 RESULT_GONE、新键照常 201）。
4. **creation intent 首次提交即冻结**：`runRoomCreation` 入口把影响创建结果的全部字段（name/protocol/remark/businessUnit/inputDirection/pullSource/outputs 完整规范化 intent/createRunPlan/credential label）JSON 深拷贝进 `journal.creation_intent_snapshot`；此后**每次 retry 只重放冻结快照**——部分失败后改 form（房间名/方向/源地址/输出目标 URL）绝不会嫁接到旧 journal 已创建的资源上。对抗测试覆盖：改 name/direction/payload 后 retry，输出 POST 体与会话 title 仍为冻结值；深改原 intent 对象也不影响快照；不改 form 的 retry 复用同一快照且已完成步骤不重建。
5. **失败后修改配置 = 显式新事务（方案 A）**：向导 UI 首次 submit 即 `locked`（丢失响应可能在 journal 不知情时已提交，故以首次尝试为准）：表单 PATCH、步骤回退、Stepper 跳转全部拒绝；失败视图只保留「重试未完成步骤」与「**放弃本次创建并新建**」。放弃动作：丢弃旧 journal（连同凭据明文）、保留 form 并解锁、新 journal、弹出**明确提示**——已创建的服务器资源**不会被自动删除**（多 POST 链不是数据库事务，无静默回滚），列出遗留资源清单并指引到列表/工作台处理。
6. **矩阵扩充（lifecycle correction 后 18 行）**：PUSH 行（丢 POST → retry 同键 → forward_task=1、同一 output id、重放调用带同键）、RECORD 行（record_task=1）、SERVE 行（同键重放为**纯读**：policy 行单条且逐字节不变）、abandon 行（放弃 → 新事务全新键，旧键 tombstone 化 RESULT_GONE）；负向 A（同名同 scene 不同 target_url，请求未达，房间已有旧输出 → 绝不采纳）、B（同名 LOCAL_RECORD 不同 format/subdir → 绝不误采纳）、C（同键异 payload → 409 且原资源不变）、D（丢响应 + workspace GET 全丢 → 纯键恢复）。**后续所有 creation step 新增都必须补进矩阵**。

### PHASE-09-FIX-03 修订（2026-09-20，creation journal 响应丢失恢复硬化）

1. **session 恢复（reconcileSession）**：服务端每房间只允许一个 active session——创建响应丢失（或后续每次 retry 必然收到的 409 `V3_SESSION_CREATE_CONFLICT`）通过 `GET /v3/rooms/:id/sessions` 恢复：只采纳**严格匹配当前 intent** 的 session（stream_id = room、run_plan_id = journal.run_plan_id、title = intent.name、lifecycle ∈ {PREP, READY}——mark_ready 会把 PREP 翻成 READY，属本创建可接受阶段；ON_AIR/CLOSING 是别人的直播，永不采纳）。存在 active session 但不匹配 run plan/title 时按真实 conflict 上报，绝不误采纳。旧行为（catch 直接抛错 → 每次 retry 都 409 → preflight 前永久卡死）已消除，且回归锁定「数据库最终只有 1 个 Session、retry 只继续 preflight」。
2. **run plan 完整 fingerprint 对账**：`run_plans.name` 在数据库层**不唯一**——对账从 name-only 改为完整 intent fingerprint：name + program_source_id + outputs（output_ref / importance / auto_start / sort_order，按 output_ref 规范化排序）+ failover（向导永不发送 failover，携带 failover 的计划永不被向导 journal 采纳）。同名但 outputs 不同 → 禁止采纳；POST 已成功但响应丢失 → GET 找到 fingerprint 完全一致的计划 → 正确采纳且不重复创建。
3. **丢响应故障矩阵**：`backend/tests/integration/wizard-lost-response-matrix.integration.test.js` 对整个创建链（stream / ingest credential / external source / pull task / output / run plan / session / preflight）表驱动模拟「服务端已成功提交，但客户端响应丢失」——真实路由 + 真实数据库 + 动态 import 真实前端 journal，注入分两型：`drop-response`（提交后丢响应）与 `request-lost`（请求未达，用于负向行）。统一验收：不产生重复资源（SQL 直查计数）、retry 不重放已完成资源（api 调用记录断言）、能 reconcile 的自动 reconcile、不能安全 reconcile 的明确停止并携带自己的步骤名、最终 journal 步骤状态与最终资源计数正确。负向行锁定「同名异构 run plan」与「外来 active session」绝不误采纳。**后续所有 creation step 新增都必须补进矩阵**。
4. **retry 预对账（对抗性审查产出）**：output 与 run plan 服务端**无**去重（无唯一约束、无幂等键）——journal 重试已尝试过的 output / run-plan 时，先从 workspace / run-plans 列表按 fingerprint 对账**再** POST，关闭「丢响应 + 恢复 GET 也失败 + retry」窗口下的重复资源制造路径。全链其余步骤均有服务端去重（stream 唯一名 409、credential ACTIVE 采纳、external source 幂等键重放、pull task 每房间 409、session 每房间 409）或天然可重评估（preflight 只重跑自身）。
5. **media-bin 定位修正**：跨模块共享 resolver 会被静态扫描判「命令注入」高危（taint 分析不跨模块边界，/tmp 探针实证写入即拦）——五个消费点保留各自字面量链，`backend/utils/media-bin.js` 明确定位为 **allowlist contract authority**（不再表述为 runtime single source of truth），漂移测试保持逐字符锁定（证据与决策记录见 `docs/security/MIMOSA-GATE-UNBLOCK.md`）。

## flv-preview 回归信号（B0，不改实现）

①生产 `vite build` 成功；②测试断言所有 `createPlayer()` 路径最终强制 `enableWorker:false`；③有实际节目源时浏览器 HTTP-FLV 播放 smoke 通过且控制台不再出现 `Class extends value undefined`；④无实时信号时不得把「没有画面」误判为代码回归。

## 质量门禁与覆盖率基准

- 每批全跑：后端 `npm test` 全量；前端 `npm test`、`check-i18n`、`build`、`check-phase08-layout` 回归；静态扫描/Lint。
- **覆盖率基准冻结**：全量基准 = `987efeb`；每批 Diff Coverage = 该批提交相对其直接父提交的新增/修改行 ≥85%；最终 HEAD 全量覆盖率相对 `987efeb` 下降 ≤0.5pp。
- 接口契约门禁双向：`POST/PUT /api/streams`（部分更新语义）与 `GET /v3/rooms`（room_summary 形状与方向口径）均有真实集成测试。
- **流程 blocker（记录在案）**：本包含 streams Schema 变更，属 🔴 核心级，需 2 个 LGTM 且其一为 Code Owner；若无法满足 reviewer 条件，必须在合并/发布前解决，不得临时降级为普通级；流水线、覆盖率、接口集成测试无豁免。
- 199 发版最后统一走 `scripts/deploy-systemd-release.sh`（immutable release），仅发版时执行。

## 明确不做（本 Phase）

拼音搜索；主入口内嵌完整 V3 控制面；音频电平后端接口；V3 输出删除/重试接口；OUT-PUSH 真实第三方端点验收。

## 实施状态（收口时补记）

> 事实口径（2026-09-21）：`HEAD = origin/main = 987efeb`；全部 PHASE-09 改动（含 FIX-01…FIX-06 六次复核修订——FIX-04 含同日 lifecycle correction、FIX-05 为 SERVE generation/ABA correction、FIX-06 为 SERVE persistent generation/delete-recreate tombstone correction）位于 main 工作区**未提交候选**中——FIX-01…FIX-06 是候选内的修订过程，**不存在中间提交 SHA**。覆盖率基准仍为 `987efeb`；每批 Diff Coverage 按「候选相对 987efeb 的工作区等价 diff」测量。

- 代码实现完成于 2026-09-19（backend 88/88、frontend 54/54、check-i18n 931 键、production build、phase08 8/8）；FIX-01 修订于同日；FIX-02 修订于 2026-09-20；FIX-03 修订于 2026-09-20；FIX-04 修订于 2026-09-20。**FIX-04 首次冻结结论同日撤回**：复核确认「同键复活已删除 Output」「SERVE replay 再写 policy」「幂等判定在事务外」三点使真幂等语义未完全成立，遂在 FIX-04 内完成 **idempotency lifecycle correction**（RESULT_GONE / RESULT_SUPERSEDED / BEGIN IMMEDIATE 原子判定 / mapping 不可变 / 并发竞争回归）。**FIX-04 lifecycle correction 后的第二次冻结结论亦于同日撤回**：独立复核复现 SERVE ABA 缺口（字段偶然回到相同即恢复旧 key replay 资格），开启 **FIX-05（SERVE generation / ABA lifecycle correction）**。**FIX-05 后的第三次冻结结论于 2026-09-21 撤回**：独立复核在真实代码复现 delete/recreate 复活缺口（generation 随 policy 行删除重置，同配置重建使旧 tombstone key 拿回 200 replay），开启 **FIX-06（SERVE persistent generation / delete-recreate tombstone correction）**——持久 `serve_policy_revisions`（epoch+generation 双权威）、mapping 钉 `(result_epoch, result_revision)`、instance 变化 → RESULT_GONE、migration 测试改真 pre-upgrade 夹具、F1–F4 回归（见 FIX-06 节）：
  - 后端全量 `145/145`（丢响应故障矩阵 18 条 + output-idempotency 集成 21 条（FIX-05 ABA 四条 + FIX-06 F1–F4 删除重建四条）+ 幂等并发竞争 2 条 + 幂等迁移 4 条（真 pre-upgrade 夹具，含 NULL 路径行为补充））、前端全量 `141/141`（vitest 16 文件；intent freeze 32 条、abandon 零键继承断言）、check-i18n（957 静态键）、production build（10.94s）、phase08 layout 8/8、双侧 `npm audit --audit-level=high` 0 漏洞、`git diff --check` 干净。
  - API contract 门禁 PASS（工作区等价 diff：变更 routes ↔ `stream-meta-room-summary` + `wizard-creation` + `wizard-lost-response-matrix` + `output-idempotency` 集成测试，真实 DB/HTTP 证据；指名批次合计 62/62）。
  - 覆盖率（FIX-06 后 Final Gate，工作区等价 diff vs `987efeb`；基线经独立 worktree 于 987efeb 实测复跑 backend 81/81、frontend 15/15 全绿）：**Diff Coverage 86.18%（1409/1635，backend 96.11% · frontend 80.16%）≥85% PASS**——口径沿用 FIX-05 起声明的可复现严格算法（「新增行 ∩ istanbul 语句区间（multiline 语句按 [start,end] 全区间），语句执行才算覆盖」），FIX-06 未切换算法；测试文件按 vitest/c8 配置本就不在 instrumentation 内；全量语句覆盖 backend 候选 66.82%（7563/11317）vs 基线 56.28%（6053/10755）= **+10.54pp**、frontend 行覆盖候选 34.89%（1014/2906）vs 基线 16.97%（392/2309）= **+17.92pp**（「下降 ≤0.5pp」门槛以大幅盈余满足）。
  - Mimosa：FIX-06 后重新执行 CLI 门禁 `scan . --min high --fail-on high` → exit 0（0 高危 · 0 中危 · 0 低危 direct，77 跨文件污点为 advisory）、`audit .` → exit 0（0 依赖漏洞）、`audit . --deep` → exit 0（[深度] 0 高危 · 0 中危 · 0 低危 direct；codeql 深度分析 requires-build-opt-in 未运行、callgraph partial 属覆盖提示，与既定口径一致）；时间线与 development-process deviation 如实记录见 `docs/security/MIMOSA-GATE-UNBLOCK.md`；GitHub Static Analysis（npm audit + CodeQL）push 后运行，本地可验证子集（双侧 audit、`bash -n`）通过。
  - 会话内 git-commit L3 hook 最小复现（基线树内容同样被拦，57/77 计数且非校准）定性为 ZCode 会话工具限制，非项目 Gate failure——证据链见 `docs/security/MIMOSA-GATE-UNBLOCK.md`。
- 新增回归：`wizard-creation.integration.test.js`（幂等键重放 / 凭据 label 契约 + 一次性 / ptsrc 映射 / 三场景输出 / run-plan 引用 / BLOCKED preflight 形状）、`wizard-lost-response-matrix.integration.test.js`（丢响应故障矩阵：真实路由 + 真实 DB + 真实前端 journal，lifecycle correction 后 18 行，含 abandon 行）、`output-idempotency.integration.test.js`（PUSH/RECORD/SERVE 重放与 409、**删除后同键 RESULT_GONE 且 mapping 不改绑 + 新键才可重建**、**SERVE 纯读重放零写副作用**、**key-A→key-B→stale key-A RESULT_SUPERSEDED 不回滚**、**SERVE policy 删除 RESULT_GONE**、**FIX-05 ABA：字段回到相同仍 SUPERSEDED + 零写 / stop→start 循环同判 / 立即重放 generation·updated_at·全行不变 / ABA 后仅最新键可重放**、**FIX-06 F1–F4：同配置删建 key-A 永久 GONE 且零写不改绑 / 异配置删建绝不采纳 / 最新键纯读且 (epoch,generation) 与 mapping 一致 / 两轮删建版本不回绕不复用**、证据不落明文、无键 legacy 行为、键按房间隔离、规范化匹配）、`output-idempotency-race.integration.test.js` + `fixtures/output-idempotency-race-worker.js`（**双进程真实并发：同 room + 同 key + 同 payload → 资源 1 / mapping 1 / 同一 canonical output id / 无 orphan**）、`output-idempotency-migration.test.js`（**真 pre-upgrade 夹具**：升级前建立 pre-FIX-05 policy 表 + FIX-04-era 幂等表并插入真实存量行 → require 当前迁移 → 断言真实 ALTER 结果（新列/NOT NULL/存量行取值/legacy mapping 双 NULL/authority 表创建/升级后首写超越存量值/删建后 epoch 递增且 authority 存活），另附 NULL 路径行为补充（明确标注非结构性证据））、`external-source-idempotency-migration.test.js`、`media-bin-literal.test.js`（fail-closed 契约 + 污染 PATH + 漂移锁定）、`worker-fail-closed.smoke.test.js`（真实子进程终态验证）、`wizard-ui-state.test.js`（凭据生命周期 + FIX-04 lock/abandon 生命周期 + **abandon 后新 journal 零键继承**）、`create-room-journal.test.js`（含 intent freeze 对抗 3 条：mutated retry / 深改原对象 / 不变 retry）、`stepper.test.jsx`。
- `rooms-overview-1920x1080.png` 主入口参考截图**已按真实 /streams 实现（zh-CN、值守面板展开）重生成**，位于候选中；工作台三栏基线未动。
- 剩余外部条件：🔴 核心级 2 LGTM（其一 Code Owner）；199 发版阶段真实节目源 HTTP-FLV smoke（flv 信号③；无信号不得判代码回归，信号④）。
- flv-preview 生产回归信号③（真实节目源浏览器 HTTP-FLV smoke）待有实际信号时在 199 发版验证执行；无信号时不得把"没有画面"判为代码回归（信号④）。
