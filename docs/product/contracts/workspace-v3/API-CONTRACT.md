# Workspace V3 API Contract

> Contract version：`workspace-v3-phase00.1`  
> 本文件定义 V3 新接口语义；V2 API 保持兼容，不在 Phase 00 删除或重命名。

## 1. Read API

### `GET /api/v3/rooms`

返回直播间总览 Read Model。每个 Room 至少包含：Room identity、当前 Session 摘要（可为 null）、Program 状态、Required Output 摘要、Recording 摘要、Health、Active Incident count。

禁止仅依据 `streams.status` 生成绿色 Health；Health 必须来自 V3 Evidence evaluator 或明确 `UNKNOWN`。

### `GET /api/v3/rooms/:roomId/workspace`

返回 `workspace-aggregate.example.json` 同构对象。顶层字段固定存在：

`contract_version / room / session / sources / program / renditions / outputs / evidence / health / capabilities / operations / incidents / timeline`。

Phase 未实现的能力返回 `null / [] / false / UNKNOWN`，不得通过省略字段暗示能力。

### `GET /api/v3/capabilities`

返回 Product / Runtime / Destination 三层 Capability，以及 explain reason。前端不硬编码“服务器一定支持某协议/编码器”。
## 2. Compatibility Explain

### `POST /api/v3/output/validate`

输入：`media / processing / mode / transport_or_format / protection / destination`。

返回：

```json
{
  "valid": false,
  "reason_code": "DESTINATION_CODEC_UNSUPPORTED",
  "message": "当前目标不支持 H.265 over RTMP",
  "alternatives": ["H.264 + AAC"]
}
```

Product/Runtime 明确不支持时不可 override；只有 Destination capability 为 UNKNOWN 时，专业模式可显式选择“仍然尝试”，并保留风险标记。

## 3. Runtime Mutation / Operation

所有会改变真实 Runtime 的 V3 动作必须进入 Operation，而不是返回一个“已经成功”的假同步状态。

建议动作形态：

- `POST /api/v3/rooms/:roomId/program/switch`
- `POST /api/v3/outputs/:outputId/start|stop|retry`
- `POST /api/v3/recordings/:outputId/stop`
- `POST /api/v3/sessions/:sessionId/start|close`

异步动作成功受理返回 HTTP `202`，主体至少包含 `operation.id / type / phase / step / subject_id`。
## 4. Idempotency 与冲突

V3 Runtime mutation 必须接受 `Idempotency-Key`；相同 key + 相同 subject/action 重放时返回同一 Operation，不重复启动 FFmpeg、不重复切源、不重复 Finalize。

若同一 subject 已存在互斥中的 Operation，返回 `409 OPERATION_CONFLICT`，并附当前 operation reference；前端应进入现有 Operation，而不是再次提交。

已处于目标状态时：

- Start 已 RUNNING → 幂等成功，不创建第二 Runtime；
- Stop 已 STOPPED → 幂等成功；
- Revoke 已 REVOKED → 返回当前状态；
- Source 已是 Program → 不创建切源 Operation。

## 5. Error Envelope

V3 错误统一为：

```json
{
  "code": "OPERATION_CONFLICT",
  "message": "Output is already stopping",
  "detail": null,
  "retryable": false,
  "correlation_id": "..."
}
```

HTTP 语义：`400` validation、`401/403` auth、`404` not found、`409` state/operation conflict、`422` capability combination invalid、`503` Runtime/Provider unavailable、`500` unexpected internal error。

错误文案不能把 `UNKNOWN` 写成 FAILED；Provider 超时应优先保留最后可信 evidence 并标记 STALE/UNKNOWN。
## 6. Secret / Evidence Boundary

Workspace/Room/Incident/Operation 普通读接口不得返回：raw source URL、raw target URL、Access Grant token/hash、AK/SK secret、password、SRT passphrase。

允许：masked URL、token hint、credential reference、provider account label、secret availability/expiry metadata。

Evidence 必须带 provenance 与 freshness；Remote evidence 如无可靠 Provider/return-path 证据，必须返回 `UNKNOWN`。

## 7. Contract Versioning

所有 V3 Aggregate 返回 `contract_version=workspace-v3-phase00.1`。破坏字段语义才允许提升 major contract；新增向后兼容字段使用同一 major 并同步本目录 Authority、fixtures 与 tests。

Phase 01 首个实现只允许提供 Read Model / Adapter；Runtime mutation API 可以保持 `capability=false`，直到对应后续 Phase 真正接管 Runtime。
