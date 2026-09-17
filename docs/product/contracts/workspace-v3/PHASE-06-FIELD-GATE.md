# Phase 06 — Field Gate

日期：2026-09-18
主机：`live` (`10.30.5.199`)
方式：隔离 Candidate SQLite / Worker / recording root；复用真实 SRS 与 FFmpeg；不替换生产 Manager，不修改生产任务。

## 场景

Run Plan 包含两路 auto-start Output：

- Required：本地 MP4 RECORD；
- Optional：故意连接失败的 RTMP PUSH。

测试 Program 使用真实 H.264/AAC RTMP Publisher。

## 结果

- 同一 Session Start `Idempotency-Key` 重放返回同一父 Operation；
- child Operation 数量固定为 2，没有重复 task；
- Required RECORD 实际进入 `RECORDING`；
- Optional PUSH 实际进入 `FAILED`；
- 父 Operation 最终 `SUCCEEDED`；Session=`ON_AIR`；
- Summary：`degraded=true`、`required_failed=0`、`optional_failed=1`。
## Reload / Persistence

使用新的 Node 进程重新打开同一 Candidate SQLite：

- Session 仍为 `ON_AIR`；
- frozen Run Plan Snapshot 保留 2 个 Output；
- `session_outputs` 保留 2 个 Output；
- `run_plan_id` 保持不变。

测试结束后 Required RECORD 正常停止并 Finalize 为 `COMPLETE`，产物约 514 KB；Candidate DB `integrity_check=ok`。

## Cleanup

- `p6_gate_*` 测试流已清零；
- 生产 Hook 测试记录删除 4 条，残留 0；
- Candidate 目录与驱动脚本已删除；
- 生产 DB integrity=`ok`；
- `srs.service`、Manager、Pull/Push/Transcode Worker 五个正式服务全部保持 `active`。

结论：Phase 06 Field Gate PASS。
