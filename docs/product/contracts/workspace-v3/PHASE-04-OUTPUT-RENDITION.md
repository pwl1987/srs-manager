# Phase 04 — Unified Output / Rendition / Scene Builder

状态：**COMPLETE**
Authority：Workspace V3 Output / Rendition 实现边界。

## 实现结论

Phase 04 不重写既有 Push / OUT-PULL / Transcode Worker，而是在其上增加统一 V3 产品层：

- `PUSH` 继续由 `forward_tasks + Push Worker` 执行；
- `SERVE` 继续由 `out_pull_policies + grants + sessions` 执行；
- `Rendition` 继续由 `stream_transcode_bindings + Transcode Worker` 执行；
- V3 只做 additive 关联、统一契约、Capability 过滤、Operation 与高保真工作流。

## Shared Rendition

`v3-rendition-service` 根据实际编码参数生成 canonical signature；模板名称与 template id 不参与 signature。两个名称不同、但 H.264/H.265、分辨率、FPS、码率、GOP、音频参数完全相同的媒体规格只创建一个 binding。

`forward_tasks.source_binding_id` 指向共享 binding；为空时保持旧行为，Push Worker 读取 Program Original。非空时 Push Worker 直接读取 derived stream，仍使用 `-c copy`，不在 Push Worker 内重复编码。

共享生命周期规则：

- 任一 RUNNING consumer 存在 → Rendition Desired=RUNNING；
- 停止单个 Output 不影响其他 consumer；
- 最后一个 RUNNING consumer 停止 → Rendition Desired=STOPPED；
- binding 仍被 Output 引用时禁止删除。

## Unified Output

`v3-output-service` 提供 Scene / Professional 两种入口，共用同一套 Capability Authority：

- PUSH：直播平台、CDN、SRT、自定义；
- SERVE：CDN Origin、合作方 Pull、播放访问；
- RECORD 仍保持 Phase 05 unavailable，不提前暴露假能力。

创建 PUSH/SERVE 配置默认不会启动受管 PUSH；Start/Stop 使用带 `Idempotency-Key` 的 Operation。PUSH Operation 必须等待真实 Runtime 收敛后才 SUCCEEDED。

## SERVE 真实性边界

当前 Runtime 的 RTMP 与 HTTP-FLV 共用同一个 `on_play` admission policy；不能分别配置一个 open、一个 grant。SRS 原生 HLS 不经过当前 `on_play` admission，因此：

- HLS 不能声称被 Access Grant 保护；
- HLS 需要反向代理/CDN 承担真实鉴权时使用 `external-proxy`；
- SERVE Stop 的产品语义为 `ADMISSION_DISABLED`，不是“所有协议物理断开”；
- Workspace endpoint 明确区分 `runtime_exposed / advertised / policy_controlled`。

## Workspace UI

生产 `StreamWorkspace` 已接入 V3 Output Rack：

- 高密度 Output 通道条；
- Scene / Professional Builder；
- Program Original / Shared Rendition 选择；
- Compatibility Explain；
- Start / Stop Operation；
- Local / Remote Evidence drill-down；
- 旧 Transcode / Forward / OUT-PULL 面板降级到 Advanced 兼容折叠区。

验证：backend full regression **50/50 PASS**；frontend i18n/build PASS。真实媒体证据见 `PHASE-04-FIELD-GATE.md`。
