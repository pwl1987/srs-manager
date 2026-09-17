# Phase 04 Field Gate — Unified Output / Shared Rendition

日期：2026-09-17

## 隔离方式

在真实 `live` 主机 `10.30.5.199` 上使用 `/tmp` Candidate 代码、独立 SQLite 数据目录和独立 Push/Transcode Worker lease；不替换生产 Manager、不修改生产 Worker 数据库，只复用真实 SRS 1935/1985/8080 与 FFmpeg。

## Shared Rendition 真实媒体证据

测试 Program：`640×360 H.264 + AAC`。测试媒体规格：`320×180 H.264 + AAC`。

两个独立 V3 PUSH Output 使用参数完全相同的 Profile 后：

- 两个 `forward_tasks.source_binding_id` 指向同一个 binding；
- `stream_transcode_bindings` 数量为 **1**；
- 真实进程只有 **1 条 transcode FFmpeg**；
- 两条 Push Worker FFmpeg 均从同一个 derived stream copy 推送；
- SRS 同时观察到 Program、一个 derived stream、Output A、Output B。

`ffprobe` 对 Output B 的真实结果：AAC 48kHz 2ch + H.264 `320×180`。

## Consumer 生命周期

停止 Output A 后：

- A 从 SRS 消失；
- Output B 继续在线；
- shared Rendition 保持 `Desired RUNNING / Runtime RUNNING`。

停止最后一个 Output B 后：

- A/B 与 derived stream 均从 SRS 消失；
- Program Original 继续在线；
- shared binding 收敛为 `Desired STOPPED / Runtime STOPPED`。

结论：同一 Rendition 多 Output 不重复编码，且引用生命周期正确。

## SERVE / Grant / HLS 边界

在同一真实 Program 上配置 `PARTNER_PULL`：

- RTMP / HTTP-FLV protection = `access-grant`；
- 无 Grant → `invalid_or_expired_grant`；
- 有效 Grant → allow；
- admission Stop 后 → `endpoint_disabled`。

同时在 admission Stop 之后直接请求 SRS 原生 HLS，仍得到 **HTTP 200**。该证据再次确认：当前 HLS 不受 `on_play` admission 控制，必须由反向代理/CDN承担保护；UI 不得显示为完全关闭。

## Cleanup Gate

- `p4_gate_*` 流最终为 0；
- 生产 `hook_events` 的测试痕迹清理为 0；
- 生产 SQLite `PRAGMA integrity_check = ok`；
- `srs.service`、Manager、Pull Worker、Push Worker、Transcode Worker 全部保持 active。

Phase 04 Field Gate：**PASS**。
