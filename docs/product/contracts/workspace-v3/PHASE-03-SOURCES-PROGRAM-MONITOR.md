# Phase 03 — Sources / Program / Secure Monitor

状态：**IMPLEMENTED / FIELD GATE PENDING**。本阶段不重写 Pull Worker/Push Worker/Transcode Worker，Program 切换仍优先复用已验证的 Pull Source Switch Operation。

## IN-PUSH Source / Ingest Credential

- 新增 `ingest_credentials` 与 `ingest_sessions`，一条凭证对应一个独立 IN-PUSH Source；
- 推流码使用 24-byte random base64url，数据库仅存 SHA-256 + `token_hint`，明文只在创建时返回一次；
- 从未创建过凭证的旧 Room 保持 legacy open ingest，保证升级不突然阻断现网编码器；
- Room 一旦创建过任意凭证即进入 credential-enforced 模式；即使全部 revoke，也不会退回匿名推流；
- `on_publish` 在写 `online` 事实前先鉴权；失败时 SRS Hook 返回非零 code；
- Managed Pull 内部回灌携带现有 `internal_media_token`，不会被外部推流凭证策略误拦；
- revoke 只阻止未来连接，不伪称已断开当前 Publisher；断开仍是独立危险动作。

## Program Attribution / Selector

- Publisher 与 `ingest_sessions` 匹配时，Program 归属具体 IN-PUSH Credential Source；
- 已启用凭证但现有 Publisher 无法归属时，显示 `UNATTRIBUTED_EXTERNAL_PUSH`，Health=DEGRADED，不猜测来源；
- IN-PULL Program 继续以 Pull Worker lease + active source + SRS Publisher 组合证明；
- V3 `POST /api/v3/rooms/:roomId/program/switch` 要求 `Idempotency-Key`；
- Phase 03 只允许 IN-PULL → 同一 PullTask 的 IN-PULL 安全切换，复用 break-before-make Operation；
- PUSH↔PULL 或切到未在线 PUSH Source 暂返回 `V3_CROSS_OWNERSHIP_SWITCH_UNAVAILABLE`，直到存在可逆 handoff，不提供假按钮。

## Secure Monitor

- Program Preview 默认 `HTTP-FLV`，fatal/不支持时自动 fallback HLS；
- HTTP-FLV 与 HLS 使用同一短时 JWT，均绑定单个 stream id/name；
- Manager 作为同源代理，HTTP-FLV 使用 streaming pipeline，不把直播流整体缓冲到内存；
- Preview 响应继续 `private, no-store / no-referrer / nosniff`；
- 浏览器 L/R RMS dBFS 电平保留，不冒充 LUFS/EBU R128。

## Source PVW

- enabled IN-PULL Source 可按需申请 source-bound preview token；
- Manager 临时启动受限 FFmpeg，`codec copy → FLV stdout → same-origin browser`；
- 默认最多 2 路临时 PVW、最长 10 分钟；关闭浏览器 PVW 即终止临时进程；
- 原始 Source URL/密码/token 永不下发浏览器；
- PGM 始终保留，PVW 明确显示 `PREVIEW · NOT PROGRAM`；
- 未实际 Publisher 的 IN-PUSH standby 不伪造 Preview 能力。

## UI 安全约束

- Workspace 创建第一条 IN-PUSH Credential 后，旧“复制裸推流地址”入口隐藏；
- 用户只能从对应来源的一次性 Server/Stream Key 获取可用推流配置；
- Pull Source “预监”与“切为 Program”保持不同动作；预监不改变 Desired/Runtime；
- 人工 Pull 切源前端已改走 V3 Program Switch + Idempotency-Key。

## 本地 Gate

- backend full regression：42/42 PASS；
- Phase 03 focused：Ingest auth/Hook、source-bound preview、HTTP-FLV/HLS preview、Program switch idempotency 全绿；
- frontend i18n/build PASS；
- `npm audit --omit=dev` 唯一 moderate 为既存 `echarts <6.1.0` advisory，非 flv.js 引入；修复需 ECharts major upgrade，单独列安全债；
- `git diff --check` PASS。

## Field Gate

Phase 03 只有在 10.30.5.199 完成以下隔离实机证据后才能标记 COMPLETE：

1. 未启用 Ingest Credential 的既有业务流保持兼容；
2. 隔离测试 Room：无/错推流码被拒绝，有效推流码真实进入 SRS；
3. Credential-enforced Room 的 Managed Pull 仍可通过 internal token 回灌并进入 Observed；
4. Program HTTP-FLV Manager Proxy 可被 ffprobe 读取；
5. Standby IN-PULL Source PVW 经 Manager 临时 FLV 路径可被 ffprobe 读取，结束后无临时 FFmpeg 残留；
6. 数据库 `integrity_check=ok`，隔离测试对象清理，五个生产服务最终 active。
