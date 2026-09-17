# SRS Manager 产品与工作流设计

本目录沉淀 SRS Manager 从“功能型 CRUD 管理后台”向“直播运维控制台”演进过程中的产品、工作流、人因工程、流向模型和运行机制基线。

## 当前版本基线

当前实现版本基线为 **v0.5.1 直播工作台 V2**；Workspace V3 已完成 UI Freeze、Phase 00 Contract 与 Phase 01 只读 Domain Compatibility Foundation，当前进入 Phase 02 Capability / Evidence / Operation Core；既有 Runtime ownership 仍保持不变。四向链路已经进入同一个单流业务工作站，并补齐真实多转码与安全预览：

- **第三方推流到我方（IN-PUSH）**：生成推流地址、观察真实 Publisher、查看状态并进行精确控制；
- **我方主动拉第三方（IN-PULL）**：外部来源、Pull Worker、FFmpeg、重试、主备切换和安全人工切源；
- **我方主动推第三方（OUT-PUSH）**：Push Worker、FFmpeg、等待输入、启停、重试与独立 Lease；
- **第三方主动拉我方（OUT-PULL）**：Origin 端点、新连接准入、Access Grant、授权吊销与当前会话控制。

## 设计文档

- [流向与控制模型 v0.1](./STREAM-FLOW-AND-CONTROL-MODEL.md) — 定义 IN-PUSH / IN-PULL / OUT-PUSH / OUT-PULL 四类链路、控制权、停止语义、联动、期望状态/观测状态、访问授权与操作状态机；
- [界面与体验整改基线 v0.1](./UI-REDESIGN-V0.1.md) — 定义专业播控台视觉方向、信息架构、设计变量、Shell 与运营中心；
- [直播工作台 v0.2](./STREAM-WORKSPACE-V0.2.md) — 当前已实现基线：采集 → SRS → 多转码 → 输出分发、实时监看与安全预览；
- [直播工作台 v0.3](./STREAM-WORKSPACE-V0.3.md) — 下一代产品设计基线：Room → Sources → Program → Renditions → Outputs，场景/专业双模式、PUSH/SERVE/RECORD 与 16:9 一屏值守；
- [Workspace V3 设计冻结](./STREAM-WORKSPACE-V0.3-DESIGN-FREEZE.md) — 冻结 Room/Session/Run Plan、Evidence、Capability、状态机、PGM/PVW 与人因交互边界；
- [Workspace V3 UI Authority](./UI-V3-PRODUCT-DESIGN-LAB.md) — 完整页面地图、导航、Product Design Lab、高保真 Workspace 五态与 1920×1080 视觉回归基线；
- [Workspace V3 实施计划](./STREAM-WORKSPACE-V0.3-IMPLEMENTATION-PLAN.md) — UI-00 → Phase 00–08 增量迁移、阶段 Gate、真实媒体验收与最终切换计划；
- [Phase 02 Evidence / Capability / Operation](./contracts/workspace-v3/PHASE-02-EVIDENCE-CAPABILITY-OPERATION.md) — 三层 Capability、Evidence freshness、Health 与持久化 Operation Core 实施边界；
- [Phase 03 Sources / Program / Secure Monitor](./contracts/workspace-v3/PHASE-03-SOURCES-PROGRAM-MONITOR.md) — IN-PUSH 凭证、Program attribution/switch、HTTP-FLV-first PGM 与按需 PVW；
- [Workspace V3 Phase 00 Contract](./contracts/workspace-v3/PHASE-00-MIGRATION-CONTRACT.md) — V2→V3 无损映射、Aggregate、Capability/Evidence/Operation 词汇与迁移边界；
- [Workspace V3 API Contract](./contracts/workspace-v3/API-CONTRACT.md) — V3 Read Model、Compatibility Explain、Operation/idempotency、错误与 secret 边界；
- [Workspace V3 Phase 01 Adapter](./contracts/workspace-v3/PHASE-01-ADAPTER-NOTES.md) — 只读 Domain Adapter、Source/Program attribution、Rendition/Output reconciliation 与 no-mutation Gate；
- [拉流运行时与四向链路联动 v0.1](./PULL-RUNTIME-AND-FLOW-LINKAGE-V0.1.md) — 定义 Pull Worker、PullTask、FFmpeg、输入所有权和运行态；
- [主备拉流与故障切换 v0.1](./PULL-FAILOVER-V0.1.md) — 定义候选源集合、自动切备、不自动回切和人工安全切源；
- [主动外推与拉流授权控制 v0.1](./OUT-PUSH-OUT-PULL-V0.1.md) — 定义 Managed OUT-PUSH、Push Worker、OUT-PULL 准入、Access Grant 与内部媒体凭证。
- [整改状态](./REDESIGN-STATUS.md) — 当前阶段、已完成、当前任务、后续任务与验证债务。

## 当前实施状态

1. P0 — 产品与四向流模型：完成；
2. P1 — UI Shell / 导航 / 设计变量 / 运营中心：完成；
3. P2 / Workspace V2 — 单流业务工作站、精确连接控制、灰阶播控视觉：完成；
4. P3-A/B — Managed Pull、主备、故障切换与人工安全切源：完成；
5. P3-C — Managed OUT-PUSH、OUT-PULL Hook 准入与授权边界：完成；
6. W2-B — 多转码 Transcode Worker、GOP/keyint、多派生流：完成并通过真实媒体测试；
7. W2-C — Manager 安全 HLS Preview Proxy、本地音频电平与观众语义：完成并通过真实媒体测试；
8. Phase UI-00 Product Design Lab：完成；高保真 UI Authority 已冻结，仍未接入真实 Runtime；
9. Phase 00 Migration/API Contract：完成；Contract tests 5/5、backend regression 32/32、frontend i18n/build PASS；
10. Phase 01 Domain Compatibility Foundation：完成；`/api/v3/rooms` 与 V3 Workspace Aggregate 已建立，Read-only reconciliation Gate 通过；
11. v0.5.1 实现继续稳定维护；Workspace V3 当前进入 Phase 02，继续在既有 Runtime 上增加统一 Capability/Evidence/Operation 解释层。

## 长期约束

- 运行态必须有真实证据来源，配置存在不能冒充“正在运行”；
- 危险动作必须说明影响范围，并允许追踪完整执行过程；
- 我方主动建立的链路必须具有完整启停、重试与恢复机制；
- 第三方主动建立的链路只能在我方控制边界内管理，不能伪造远端控制能力；
- 日常值守优先减少页面跳转、重复输入和人工判断；
- 界面保持“平时安静、异常醒目”，不使用无意义的高饱和装饰制造噪声；
- 没有 Runtime 支撑的能力不能在 UI 中伪造成“已运行”。
