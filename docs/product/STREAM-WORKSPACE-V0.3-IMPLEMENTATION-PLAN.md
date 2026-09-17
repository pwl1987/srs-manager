# Workspace V3 分阶段实施计划

> Authority：`STREAM-WORKSPACE-V0.3-DESIGN-FREEZE.md`  
> 稳定基线：v0.5.1 Workspace V2  
> 策略：增量迁移、兼容适配、逐阶段 Gate；禁止 Big Bang 重写。

## 总体原则

- 每阶段必须保持现有 Pull / Push / Transcode / Preview / Hook 能力可回归；
- 数据迁移优先 additive，不删除旧字段/表，不破坏 v0.5.1 回退能力；
- 先建立 V3 Domain/Read Model，再逐步切 UI 和 Runtime ownership；
- 旧模块页可以长期兼容，但不得继续承载新业务能力；
- Configured、Desired、Runtime、Observed、Remote Verified 始终分离；
- 每阶段只有通过 focused tests + backend regression + frontend build/i18n + 必要现场媒体证据后才能进入下一阶段。

## Phase UI-00 — Product Design Lab / UI Freeze

状态：**COMPLETE**。目标是在任何 V3 Runtime/Schema 迁移前先冻结完整产品 IA、Shell、Workspace 与外部资源页面，避免实现阶段由 Agent 临时设计 UI。

Authority：`UI-V3-PRODUCT-DESIGN-LAB.md` + `frontend/src/design-lab/` + `docs/product/ui-v3/reference/`。Design Lab 仅使用 Mock 数据；开发环境可直接访问，production build 仍受认证保护。

Gate 已满足：前端 i18n/build PASS；1920×1080 直播间总览、Workspace PREP/ON AIR/PVW/INCIDENT/CLOSING、媒体规格、开播方案、Provider/Session/状态样板完成实渲染校验；不得将 Mock 状态冒充 Runtime。

## Phase 00 — Design Freeze / Migration Contract

状态：**COMPLETE**。Authority：`contracts/workspace-v3/PHASE-00-MIGRATION-CONTRACT.md`、`API-CONTRACT.md`、`contract.json`。

目标：把口头设计转换为可实施 Contract，仍不改业务 Runtime。

交付：
- 冻结 Room / Source / Program / Rendition / Output / Session / Run Plan / Evidence / Operation 数据契约；
- 建立 V2 → V3 映射表和兼容边界；
- 冻结 PUSH / SERVE / RECORD Capability Matrix 与状态机；
- 定义 Workspace V3 聚合 API、错误语义、幂等规则、Evidence freshness；
- 为后续各阶段写出可自动验证的 acceptance fixtures。

Gate：**PASS**。V2 事实类均有 lossless mapping；Contract tests 5/5、backend regression 32/32、frontend i18n/build PASS；Phase 00 未修改 Worker/Runtime 执行语义。

## Phase 01 — Domain Compatibility Foundation

状态：**COMPLETE**。Authority：`contracts/workspace-v3/PHASE-01-ADAPTER-NOTES.md`。

目标：在不改现有 Runtime ownership 的前提下建立 V3 领域兼容层。

交付：
- 为现有 `streams`、Pull、Publisher、Transcode binding、Forward/OUT-PUSH、OUT-PULL/Grant 建立 V3 Domain Adapter；
- 新增必要的稳定领域 ID / relation，但保持旧 API 可用；
- 形成只读 V3 Workspace Aggregate，能够统一返回 Sources、Program、Renditions、Outputs 和现有 Evidence；
- 旧数据升级必须幂等，可重复启动，不自动改变 Desired State；
- 增加 migration/reconciliation tests，保证历史数据不被重复制造或丢失。

Gate：**PASS**。V3 只读 Adapter 对 V2 facts 做无损 reconciliation；Read Model 前后 Runtime/Desired fingerprint 不变；Standby/Provider/legacy Dynamic 均无假绿；focused 6/6、backend 33/33、frontend i18n/build PASS。

## Phase 02 — Capability / Evidence / Operation Core

状态：**COMPLETE**。

目标：先统一“系统知道什么、能做什么、动作进行到哪一步”，不急着换 UI。

交付：
- Capability Registry：Product / Runtime / Destination 三层能力与 explain reason；
- Evidence 模型：provenance、timestamp、freshness、LOCAL/REMOTE、UNKNOWN/STALE；
- Health evaluator：Expected vs Actual + impact，不使用不透明评分；
- Operation 基础设施：Start/Stop/Retry/Switch 等幂等 operation 和冲突控制；
- 对现有 Pull/Push/Transcode runtime 增加 V3 状态投影，而不是重写 worker。

Gate：**PASS**。现有 Runtime 状态经新 Evidence/Health 层解释后不出现“假绿”；Operation idempotency migration 无损；focused 11/11、backend 38/38、frontend i18n/build PASS。新的 V3 Runtime mutation public API 仍关闭，按后续领域 Phase 开放。

## Phase 03 — Sources / Program / Secure Monitor

状态：**COMPLETE**。

目标：先把左侧输入和中央监看切到 V3 业务模型，Output 仍可继续兼容展示。

交付：
- Source Rack：多个 PUSH/PULL Source、角色、Ready/Offline/Program 状态；
- PUSH Source 独立 Ingest Credential、复制地址、禁用/轮换凭证；
- Source Selector：人工切源、PRECHECK/SWITCHING/VERIFYING、失败保护旧 Program；
- Program Monitor：默认单 PGM；按需 Source Preview 时临时 PGM + PVW，明确 `NOT PROGRAM`；
- Manager 安全预览优先 HTTP-FLV，HLS fallback，继续使用短时授权与同源代理边界；
- 固定视频/音频/码率/L-R dBFS 一线证据。

Gate：**PASS**。真实 PUSH/PULL、HTTP-FLV PGM + HLS fallback、按需 PVW、A→B 切换均在 `10.30.5.199` 隔离 Candidate 通过；故障注入确认目标源不可用时 Operation FAILED 后自动 rollback 旧 Program。证据见 `contracts/workspace-v3/PHASE-03-FIELD-GATE.md`。

## Phase 04 — Unified Output / Rendition / Scene Builder

目标：把 Forwarding、OUT-PULL、Transcode 挂载收敛到统一 Output 业务对象，但保留现有 worker 实现。

交付：
- Output `PUSH / SERVE` 统一模型与 Runtime Adapter；
- Shared Rendition signature / reuse：相同处理参数只建立一份派生媒体；
- 场景模式首批预设 + 专业模式 Capability filtering；
- PUSH 单 Destination/Transport；SERVE 单 Consumer + 多 Endpoint；
- Protection / Destination 动态配置与 compatibility explain；
- 右侧高密度 Output 通道条、异常临时上浮、Evidence drill-down。

Gate：**PASS**。真实 `live` 主机隔离 Candidate 已验证：两个 Output 共用一个 canonical Rendition、真实 Transcode FFmpeg 仅一条；停止单个 consumer 不影响共享 Rendition，停止最后一个 consumer 后 derived stream 正确退出；PARTNER_PULL Grant admission 与 HLS 外部保护边界再次实证。证据见 `contracts/workspace-v3/PHASE-04-FIELD-GATE.md`。

## Phase 05 — RECORD / Storage Runtime

目标：把本地录制作为正式 Output Mode 接入，不与网络输出另起一套产品模型。

交付：
- RECORD Output、TS / MP4 / Audio File、分段、文件名模板、目录和保留策略；
- 普通 MP4 采用抗中断录制 + 正常停止 remux/finalize 的安全路径；
- `STARTING / RECORDING / STOPPING / FINALIZING / COMPLETE / STALLED / FAILED`；
- 文件增长、时长、大小、可恢复产物作为 Observed Evidence；
- 磁盘空间转换成“预计剩余可录时长”，并定义低空间告警阈值；
- Recording 复用已有 Rendition，不重复转码。

Gate：**PASS**。正常 MP4/TS、Candidate Manager 重启、Record Worker 硬杀后 RECOVERABLE + 新 Asset 续录、磁盘不足阻断、分段与最终封装均获得真实文件证据；见 `contracts/workspace-v3/PHASE-05-FIELD-GATE.md`。

## Phase 06 — Session / Run Plan / Preflight

目标：把“直播间长期配置”和“一次真实直播”分离，形成可复用开播方案。

交付：
- Session 生命周期：PREP → READY → ON AIR → CLOSING → ENDED；
- Run Plan：Program 候选、Required/Optional Outputs、Recording、Failover 意图；
- 开播编排：局部成功，不因单个 Output 失败回滚健康链路；
- Preflight：BLOCKER / WARNING / INFO，只检查本场相关依赖；
- 临时 Output 默认仅属于本 Session，允许结束后显式保存为长期配置；
- 直播中修改默认“仅本场”，更新长期 Run Plan 必须显式选择。

Gate：标准方案重复执行无重复任务；Required/Optional 影响 Health 正确；Session 重启/reload 后仍能根据 Runtime facts 恢复真实状态。

## Phase 07 — Incident / Health / Closing Workflow

目标：让系统从“展示状态”升级为“帮助值班员发现、定位、恢复问题”。

交付：
- Active Incidents：Signal / Delivery / Resource / System 四类底层分类，UI 按业务影响排序；
- Incident 内容固定回答：发生了什么、影响什么、当前还能不能播、建议动作；
- Acknowledge ≠ Resolved；自动恢复、人工恢复、Recovered Timeline 分开记录；
- Program / Rendition / Output 影响链计算，避免“一处红、全局红”；
- CLOSING 编排和收播摘要：停止网络输出、Finalize 录制、停 Pull、释放 Program、检查残留；
- 底部状态轨正常安静，异常时按需展开；资源指标翻译成业务后果。

Gate：Program Source Lost、Single Output Failed、Rendition Failed、Disk Low、Worker Lost 等故障注入通过；3 秒扫描与 10 秒故障测试达到设计目标。

## Phase 08 — 16:9 Cutover / Compatibility Cleanup / Release Gate

目标：完成 Workspace V3 主工作流切换，同时保留必要兼容和明确回退路径。

交付：
- 1920×1080 主布局：左 Sources / 中 PGM/PVW / 右 Outputs / 底 Incidents；
- PREP / ON AIR / INCIDENT / CLOSING 只改变视觉权重，不破坏空间位置；
- Drawer 内完成 Source/Output/Run Plan 等编辑，正常工作流不再跳旧模块页；
- 1366×768、1440P、4K 和移动监看降级策略验收；
- 对旧 `/forwarding`、旧 Monitor、旧单模板字段做使用审计，只有确认无依赖后才标记 deprecated；
- 完整真实媒体、升级、回滚、重启恢复、权限、安全、CI、部署验收与发布说明。

Gate：真实部署主机完成整场 PREP → ON AIR → INCIDENT → RECOVERY → CLOSING 闭环；v0.5.1 数据升级无损，旧兼容入口无阻断性回归，才能宣布 V3 COMPLETE。

## 阶段依赖与推进纪律

推荐顺序固定为：`UI-00 → 00 → 01 → 02 → 03 → 04 → 05 → 06 → 07 → 08`。UI-00、Phase 00–06 已 COMPLETE；Current Task 为 Phase 07 Incident / Health / Closing Workflow。后续阶段不得绕过既有 Domain/Evidence/Capability Authority 形成第二套状态逻辑。

每阶段结尾必须同时更新：
- `REDESIGN-STATUS.md` 的 Current Phase / Last Completed / Current Task / Next Task；
- 相关 Contract / migration decision；
- 自动化测试与现场 Evidence；
- 已知 Verification Debt。

禁止用 UI mock 状态代替尚未完成的 Runtime；禁止为了 V3 删除 v0.5.1 已验证能力；禁止同一阶段同时重写 worker、schema、UI 和部署体系。

## V3 Complete 判定

只有以下条件全部满足才允许标记 Workspace V3 COMPLETE：领域映射无损、能力矩阵由同一 Authority 驱动、PGM/PVW 监看可信、PUSH/SERVE/RECORD 三类 Output 闭环、Session/Run Plan/Preflight 可重复执行、Incident/Closing 可恢复、真实主机整场回归通过、升级和回退路径有证据。

设计冻结后的新增想法默认进入 V3.x / 后续 backlog，不插入正在执行的 Phase，除非发现 Authority 冲突、安全缺陷或当前设计无法实现。