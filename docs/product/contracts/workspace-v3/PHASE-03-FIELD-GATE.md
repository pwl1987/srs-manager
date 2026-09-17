# Workspace V3 Phase 03 Field Gate

日期：2026-09-17
环境：真实 `live` 主机 `10.30.5.199`，Candidate Manager 使用独立 `:3103`、独立 SQLite 数据目录；生产 `:3001` 与生产 Worker 未替换。

## 现场媒体证据

- 真实 IN-PUSH 测试流进入 SRS，Program 为 H.264 `640×360` + AAC 48 kHz。
- Candidate 安全 PGM HTTP-FLV 代理返回 200，短采样约 208 KB；`ffprobe` 验证 H.264 `640×360` + AAC。
- HLS fallback 返回 200，playlist 已改写为 Manager 同源 `/api/preview/...` 地址。
- IN-PULL PVW 对 Source B 返回 200，短采样约 133 KB；`ffprobe` 验证 H.264 `320×240` + AAC。
- PVW 客户端关闭后临时 FFmpeg 已回收，无预监子进程残留。

## Program Switch

- Candidate Pull Worker 从 Source A 建立 Program，真实 SRS 观察 `640×360`，Task=`RUNNING` 且有 Worker ownership。
- A→B 切源现场成功，Operation=`SUCCEEDED`，Program 实际变为 Source B 的 `320×240`。
- 故障注入发现 VERIFYING 曾绕过通用 startup timeout；已修复为切源状态机内的 target publisher timeout。
- 目标 Source A 断流时再次切换：Operation=`FAILED`，结果记录 `recovery=rollback`，自动恢复 Source B。
- 回滚后 Task=`RUNNING`、`active_source_id=2`，Program 再次观察到 `320×240`；失败切源未永久破坏健康旧 Program。

## IN-PUSH Credential / Hook 控制面

- Candidate 隔离 DB 创建测试直播间与第一枚 Ingest Credential。
- 无凭据调用 `on_publish`：HTTP 200 / body `code=403`，按 SRS hook 语义拒绝。
- 有效凭据调用 `on_publish`：HTTP 200 / body `code=0`，放行。
- Candidate DB 记录 `session_kind=external`，credential 已绑定，测试 stream 状态更新为 online。
- 测试过程中未在日志/验证输出中暴露凭据明文。

## 清理与最终 Gate

- Candidate `:3103`、隔离 Pull Worker、全部 `p3_gate_*` FFmpeg 已停止。
- SRS 中 `p3_gate_*` 流清零；生产 `hook_events` 中测试记录清零。
- 生产 DB `PRAGMA integrity_check = ok`。
- `srs.service`、Manager、Pull/Push/Transcode Worker 五个生产服务均保持 active。
- 生产 Manager/Worker 本轮未替换；本 Gate 证明候选代码在真实 `live` 主机媒体面可成立，不等同于 Phase 08 production cutover。
- 最终本地 Gate：backend `46/46 PASS`、frontend i18n/build PASS、`git diff --check` PASS。
