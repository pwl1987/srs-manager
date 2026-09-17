# Workspace V3 Phase 00 Migration Contract

> 状态：FROZEN FOR IMPLEMENTATION  
> Contract version：`workspace-v3-phase00.1`  
> 上位 Authority：`STREAM-WORKSPACE-V0.3-DESIGN-FREEZE.md`、`UI-V3-PRODUCT-DESIGN-LAB.md`

## 1. 目的与边界

Phase 00 只冻结 V2 → V3 的无损映射、聚合 API 语义、Capability、Evidence 与状态机，不修改 Pull / Push / Transcode / Preview / Hook Runtime ownership。

硬约束：

- migration 必须 additive，v0.5.1 数据和 API 保留回退能力；
- `Configured ≠ Desired ≠ Runtime ≠ Observed ≠ Remote Verified`；
- Provider 配置、历史事件、Worker 进程存在都不能单独证明远端业务健康；
- `UNKNOWN` 是一等状态，不得降级为 `FAILED`，也不得升级为“健康”；
- Workspace Aggregate 不允许返回原始 source URL、target URL、token/hash、AK/SK secret、password/passphrase；
- Phase 01 Adapter 必须消费本目录 `contract.json` 的词汇，不得自行发明第二套状态。

## 2. Room 与兼容路由

V3 `Room` 是长期业务工作空间；V2 `streams` 继续保留为兼容媒体路由身份。

迁移时每个 V2 stream 恰好生成一个 Room：

```text
streams.id = 22
→ room.id = room:22
→ room.legacy_stream_id = 22
→ routing.app = live
→ routing.stream_name = streams.name
```

Phase 01 **不新增第二套 Room SoR**：先用确定性 `room:<streams.id>` 作为稳定 Domain ID，由 Adapter 把 `streams` 投影为 Room。以后若因 Session/业务元数据需要独立持久化 Room，也必须保持该 Domain ID 与 `canonical_stream_id` 关系不变。禁止重命名、删除或改变现有 `streams.name` 的 SRS 路由语义。
## 3. Source / Program 映射

### IN-PULL

`external_sources + pull_tasks + pull_task_sources` 映射为 V3 SourceSet。每个候选源必须保持独立 ID、priority、enabled、status；`active_source_id` 只表示 Pull Runtime 当前候选，不等于 Program 已经成功切换。

只有同时满足以下证据时，Program 才能归因到某个 Managed Pull Source：

1. PullTask `desired_state=RUNNING` 且 Runtime 处于有效运行态；
2. Pull Worker lease/instance 与任务归属匹配；
3. SRS 真实观察到 canonical Program stream Publisher；
4. active source 可明确对应到该任务。

缺失任一证据时不得把“配置中的 active source”显示为正在播出的 Program。

### IN-PUSH

V2 没有持久化的多 PUSH Source 对象。Phase 01 为每个 legacy stream 合成一个兼容 Source：`source:in_push:legacy-<streamId>`，表示现有推流入口；真实 SRS Publisher 只是该 Source 的 Observed Evidence。

若 Publisher 可证明属于 Managed Pull，则不能同时再生成一个“外部 PUSH 正在播”的重复事实。

### Program

Program 永远只有一个。状态词汇固定为 `NO_PROGRAM / READY / LIVE / SWITCHING / VERIFYING`。多 Source 可以同时 READY，但任意时刻只能有一个 `program.source_id`。

如果 SRS 出现无法可靠归因的多 Publisher/冲突证据，Program 进入非健康状态并保留原始 evidence，不得随意挑一个来源显示正常。

## 4. Rendition / Media Profile 映射

`transcode_templates` → `MediaProfile`；模板存在只表示可复用规格，不表示 Runtime。

`stream_transcode_bindings` → `Rendition instance`。Phase 01 必须逐条保留现有 binding/runtime，计算 canonical signature 供后续 Phase 04 复用，但在 Phase 04 前不得因为 signature 相同而自动合并或停止现有 pipeline。

Program Original 是一个合成的 Passthrough Rendition，不需要创建额外 FFmpeg。
## 5. Output 映射

### PUSH

`forward_tasks.execution_mode=managed_worker` → V3 `Output(mode=PUSH)`，保留 Desired/Runtime、attempt、last_error、worker ownership 与 masked destination。

`execution_mode=srs_dynamic` 只能投影为 `control_mode=LEGACY_UNMANAGED`，V3 runtime 显示 `UNKNOWN`，不得声称 Manager 能可靠停止、重试或验证远端。

PUSH 当前 Product Capability：`RTMP / RTMPS / SRT`。`HLS PUSH`、`HTTP-FLV PUSH` 不存在于 V3 Capability。

### SERVE

`out_pull_policies + access_grants + out_pull_sessions` → 一个 `Output(mode=SERVE)`，其下允许多个 Endpoint：`RTMP / HTTP-FLV / HLS`。

`AVAILABLE + 0 sessions` 是正常状态，不得显示 STOPPED/FAILED。Access Grant 是 Protection；revoke grant 与 disconnect current session 保持独立语义。

SRS 8080 直连 HLS 不经过当前 `on_play` admission，因此 HLS Endpoint 必须带 `protection_boundary=reverse_proxy_or_cdn`；不得声称 Grant 已保护直连 HLS。

### RECORD

V2 无 RECORD Runtime。Phase 00/01/02/03/04 中 `capabilities.record=false`；在 Phase 05 完成真实文件 Runtime 前不得显示可执行 REC 能力。

## 6. Provider / CDN 与历史对象

`cdn_channels` 映射为 Provider Integration / Destination Capability / Remote Evidence candidate。**仅有 channel 配置不能创建 RUNNING Output。**

只有当本地 delivery relationship（PUSH task、SERVE origin relationship 等）可证明时，Provider 信息才附着到具体 Output。

`distribution_requests` 暂作为 `compatibility.legacy_distribution` 保留；不得自动升级为 Output 或 Access Grant。

`auth_keys / wangsu_auth / aliyun_dns_auth` 属于 Credential/Integration secret resource。Workspace 只允许引用 ID、label、masked metadata 和有效状态。
## 7. Evidence / Health Contract

Evidence 层级固定为：`CONFIGURED → DESIRED → RUNTIME → OBSERVED → REMOTE_VERIFIED`。每条可观测证据至少携带：`source`、`observed_at`、`freshness`。

Remote Evidence 状态固定为：`VERIFIED / UNKNOWN / STALE / UNAVAILABLE`。本地 FFmpeg RUNNING、socket connected 或 send bitrate 只能证明 LOCAL，不能升级为 Remote Verified。

Health 固定为 `NORMAL / DEGRADED / CRITICAL / UNKNOWN`，由 `Expected vs Actual + Business Impact` 推导。Lifecycle/Activity 与 Health 分离：计划内 STOPPED/OFF AIR 可以是 NORMAL。

典型规则：

- Program Publisher 丢失且 Session 期望 ON AIR → CRITICAL；
- 非关键备用源离线，Program 正常 → DEGRADED/Warning，不影响 Program NORMAL evidence；
- 单个 Required Output FAILED → Session `ON AIR · DEGRADED`；
- Transcode Runtime RUNNING 但 derived media 未 Observed → Rendition 非 NORMAL；
- Remote status 未接入 → UNKNOWN，不是 FAILED，也不是 VERIFIED。

## 8. Operation Contract

统一 Operation phase：`QUEUED / RUNNING / VERIFYING / SUCCEEDED / FAILED / CANCELLED`；具体动作细节进入 `step`。

现有 Pull Switch 映射：

```text
QUEUED     → QUEUED / REQUESTED
STOPPING   → RUNNING / STOPPING_OLD_SOURCE
STARTING   → RUNNING / STARTING_TARGET
VERIFYING  → VERIFYING / NONE
SUCCEEDED  → SUCCEEDED / NONE
FAILED     → FAILED / NONE
CANCELLED  → CANCELLED / NONE
```

Phase 01 不重写历史 operations；只做 projection。后续 Start/Stop/Retry/Finalize 使用同一 phase grammar，并必须保证幂等和冲突动作互斥。

## 9. Workspace Aggregate

V3 Aggregate 顶层固定为：`contract_version / room / session / sources / program / renditions / outputs / evidence / health / capabilities / operations / incidents / timeline`。

兼容字段必须放入 `compatibility` 命名空间，避免 V2 存储结构污染正式 V3 Contract。示例见 `workspace-aggregate.example.json`。

Phase 01 的 Read Model 可以暂时返回 `session=null`、`incidents=[]`，但字段必须存在；不得让前端根据“字段有没有”猜 Phase 能力。
## 10. Phase 00 Gate

Phase 00 只有以下全部成立才允许进入 Phase 01：

1. `contract.json`、本文件、Design Freeze 和 UI Authority 不冲突；
2. 当前 V2 所有业务事实类都能映射且 `lossless=true`；
3. PUSH/SERVE/RECORD Capability 不出现实现外组合；
4. legacy dynamic forward、direct HLS、Provider config-only 三类边界不会制造假绿；
5. Aggregate 示例不含原始 secret；
6. acceptance cases 覆盖 Publisher、Managed Pull、Transcode、PUSH、SERVE、Provider、Operation、Secret redaction；
7. 纯 Contract tests + backend full regression + frontend i18n/build 全绿；
8. Phase 00 不新增/修改任何 Worker 执行语义、不自动改变 Desired State。

Gate 通过后的 Current Task 才能转换为 **Phase 01 — Domain Compatibility Foundation**。
