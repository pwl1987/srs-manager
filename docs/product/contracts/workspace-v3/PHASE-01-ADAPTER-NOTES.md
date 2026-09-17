# Workspace V3 Phase 01 Domain Compatibility Foundation

> 状态：COMPLETE  
> Contract：`workspace-v3-phase00.1`  
> 原则：只读投影、无第二套 SoR、无 Runtime ownership 迁移。

## 1. 实现范围

新增 `v3-workspace-service`，把当前 V2 事实投影为冻结的 V3 Workspace Aggregate；新增 JWT 保护的只读接口：

- `GET /api/v3/rooms`
- `GET /api/v3/rooms/:roomId/workspace`

Room Domain ID 采用确定性 `room:<streams.id>`。Phase 01 不新增 `rooms` 表，不复制现有 Stream 配置，也不改变 `streams.name` 的 SRS routing 语义。

## 2. Source / Program reconciliation

- legacy stream 始终可投影一个兼容 IN-PUSH Source，但只有真实外部 Publisher evidence 才能成为 Program；
- Managed Pull 只有在 PullTask、Worker ownership 与 SRS Publisher 同时成立时才归因到 IN-PULL Source；
- Managed Pull 可能拥有 Publisher、但 ownership evidence 不完整时使用 `UNKNOWN_PULL_OWNERSHIP`，禁止错误归因为外部 PUSH；
- 多 Publisher evidence 使用 `AMBIGUOUS_MULTIPLE_PUBLISHERS`，禁止任意挑选；
- 未主动探测的 Standby Pull Source 投影为 `UNKNOWN`，不伪造 `READY`；
- SRS API 不可用时 Program=`UNKNOWN`；SRS 可用且未观察到流时才是 `NO_PROGRAM`。

## 3. Rendition / Output reconciliation

- Program Original 作为合成 Passthrough Rendition；不启动额外 FFmpeg；
- 每个现有 Transcode Binding 独立投影为 Rendition，并计算规范化 signature；Phase 04 前不自动去重；
- Binding Runtime=RUNNING 但派生流未被 SRS Observed 时，保留 Runtime，同时 `observed.online=false`；
- Managed Forward Task 投影为 PUSH Output；本地 Worker ownership 只达到 Runtime evidence，Remote 默认 UNKNOWN；
- legacy `srs_dynamic` Forward 投影为 `LEGACY_UNMANAGED + runtime=UNKNOWN`，证据最高只到 DESIRED；
- OUT-PULL policy 投影为单个 SERVE Output，包含 RTMP / HTTP-FLV / HLS Endpoint；零会话不构成故障；
- CDN channel 只进入 Provider compatibility metadata，`runtime_claim=false`，不会凭配置生成 Output。

## 4. 安全与兼容

V3 Aggregate 不返回 raw source/target URL、token/hash、AK/SK secret、password、passphrase。只保留 masked URL、token hint 和安全元数据。

HLS Endpoint 继续声明 `protection_boundary=reverse_proxy_or_cdn`，不扩大当前 SRS Hook 的真实安全边界。

Phase 01 的 Health 固定为 `UNKNOWN`，因为 Phase 02 evaluator 尚未接管；这比根据历史 DB 状态制造“绿色”更安全。

## 5. Read-only invariant

Focused reconciliation test 对 Pull / Push / Transcode 的 `desired_state / runtime_state / worker_instance_id / active_source_id` 做前后 fingerprint；读取 V3 Aggregate 后必须完全一致。

因此 Phase 01 只建立新的观察视角，不会 auto-start、auto-stop、切源、重建 pipeline 或改变 Worker Lease。

## 6. Gate evidence

- focused V3 Contract + Adapter tests：6/6 PASS；
- backend full regression：33/33 PASS；
- frontend i18n + production build：PASS；
- `git diff --check`：PASS；
- 无数据库 schema 变化；
- 无 Pull/Push/Transcode/Preview/Hook Worker 代码变化；
- 无 Runtime mutation V3 API。

Phase 01 Gate 通过后，Phase 02 才允许引入 Capability Registry、Evidence freshness/LOCAL-REMOTE evaluator、Health evaluator 与通用 Operation 基础设施。
