# Phase 02 — Capability / Evidence / Operation Core

状态：**IMPLEMENTED / GATE PENDING**。本阶段继续复用 v0.5.1 Pull / Push / Transcode / Preview / Hook Runtime，不改变 Worker ownership。

## 已实现

- `v3-evidence-service`：统一 provenance、`observed_at`、TTL、`FRESH / STALE / UNKNOWN`；
- `v3-capability-service`：Product / Runtime / Destination 三层能力与组合 explain；
- `v3-health-service`：Expected vs Actual + impact，Remote UNKNOWN 不冒充 Failure；
- `v3-operation-core`：持久化 Idempotency-Key、同 subject 冲突控制、通用 Operation phase transition；
- `GET /api/v3/capabilities`；
- `POST /api/v3/output/validate`；
- `GET /api/v3/operations/:operationId`；
- Workspace / Room Overview 接入真实 Health，而不是 Phase 01 `UNKNOWN` 占位。

## Truthfulness 边界

- SRS API 调用失败时 Program 为 `UNKNOWN`，`observed_at=null`；查询失败时间不得冒充媒体观测时间；
- Managed PUSH 的本地 Worker 证据与 Remote evidence 分开，Remote 无 Provider/return-path 证据时保持 `UNKNOWN`；
- Direct HLS + Access Grant 仍判为非法组合；现有 `on_play` Hook 不保护 SRS 8080 直连 HLS；
- `cdn_channels` 的 Wangsu live state 可作为 Provider remote evidence candidate，但 channel 配置本身仍不是 Output Runtime；
- RECORD 产品模型存在，但 Runtime capability 明确为 unavailable，直到 Phase 05；
- Destination `CUSTOM` capability 默认为 `UNKNOWN`，专业模式可显式 override；Product/Runtime 明确不支持时不可 override。

## Health 规则

- `NO_PROGRAM + 无 Desired RUNNING`：Health `NORMAL`，原因 `OFF_AIR_EXPECTED`；Offline 本身不是故障；
- `NO_PROGRAM + 有 Desired RUNNING`：`CRITICAL`；
- Requested Rendition RUNNING 但派生媒体未 Observed：`DEGRADED`；
- Requested PUSH FAILED、Worker heartbeat 缺失或 evidence stale/unknown：`DEGRADED`；
- SRS Evidence unavailable：`UNKNOWN`，不写 FAILED；
- Remote `UNKNOWN` 单独不会降低 Health。

## Operation 边界

Phase 02 已建立持久化通用 Operation Core，但**不开放新的 V3 Runtime mutation API**。`runtime_mutation.public_api=false` 是真实 Capability。

原因：Program Switch 属于 Phase 03，Unified Output Start/Stop/Retry 属于 Phase 04，Recording/Session mutation 分别属于 Phase 05/06。提前暴露动作会造成 V3 UI 能操作尚未接管的 Runtime。

`operations.idempotency_key` 为 additive migration；旧 Operation 行保持不变。唯一约束为 `(type, subject_type, subject_id, idempotency_key)`，NULL 不受影响。

## Gate

- focused Phase 00–02 contract/evidence/capability/health/operation tests 全绿；
- legacy Operation migration 无损；
- backend full regression；
- frontend i18n/build；
- `git diff --check`；
- Read Model 不修改现有 Desired/Runtime。
