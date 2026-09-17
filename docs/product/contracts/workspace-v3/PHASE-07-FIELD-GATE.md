# Workspace V3 Phase 07 — Field Gate

日期：2026-09-18
环境：真实 `live` 主机上的隔离 Candidate DB + 真实 SRS / FFmpeg 媒体面。生产 Manager/Worker/业务数据库不作为 Candidate SoR。

## 自动回归

- backend：`69/69 PASS`；
- Phase 07 focused：`5/5 PASS`；
- frontend：i18n check PASS + production build PASS；
- `git diff --check`：PASS。

## 故障注入

### Program Source Lost

真实 synthetic Publisher 先进入 SRS，随后停止 Publisher。结果：`PROGRAM_EXPECTED_NOT_OBSERVED`、severity=`CRITICAL`、`program_affected=true`，影响全部依赖 Program 的 Output；Publisher 恢复后 Incident 自动进入 `RECOVERED`。

### Single Required Output Failed

Program 保持真实在线，只令一个 Required PUSH Output 失败。结果：Incident=`CRITICAL`，只影响该 Output，`can_still_broadcast=true`；ACK 后保持 `ACKNOWLEDGED`，Runtime 恢复后的事件顺序为 `OPENED → ACKNOWLEDGED → RECOVERED`。

### Rendition Failed

共享 Rendition 失败时，只影响依赖该 Rendition 的 Output，其他 media_ref 的 Output 明确不受影响。

### Disk Low

对正在 RECORD 的 Output 注入 low-space Capability。结果：category=`RESOURCE`，只影响 Recording 链，不把 Program / 网络 Output 误判为故障。

### Worker Lost

对正在运行的 Managed PUSH 注入 Worker heartbeat unavailable。结果：category=`SYSTEM`，影响受管 PUSH Outputs；Program 仍健康时 `can_still_broadcast=true`。

## Closing

同一份 Candidate 代码在真实 `live` 主机环境执行 Closing Gate：`2/2 PASS`。验证 Network → Recording Finalize → Managed Pull → ENDED 顺序、幂等 close，以及遇到 Legacy unmanaged Output 时拒绝假 ENDED。

## 清理与生产复核

- `p7_gate_*` SRS 流：0；
- synthetic Hook rows：2 → 0；
- SRS / Manager / Pull Worker / Push Worker / Transcode Worker：全部 `active`；
- 生产 SQLite：`integrity_check=ok`；
- Candidate `/tmp` 目录已删除。

## 人因 Gate

当前生产 Workspace 已满足结构性故障识别要求：Active Incident 在 Operations Dock 首层显示，并直接给出 severity、影响范围、“当前还能否播”和建议动作；危险的 Session Close 固定在 Session Command Bar，并有影响说明确认。

最终“3 秒扫描 / 10 秒故障处置”的 1920×1080 人工计时验收随 Phase 08 最终 Cutover 再执行一次；Phase 07 不把尚未最终切换的页面密度宣称为终态。
