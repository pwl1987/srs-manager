# Workspace V3 Phase 05 — Record Field Gate

日期：2026-09-18
主机：`live` / `10.30.5.199`
方式：真实 SRS + FFmpeg，隔离 Candidate 代码 / SQLite / Recording Root；未替换生产 Manager，未改生产业务任务。

## 正常 MP4

- Program：`p5_gate_program`，H.264 640×360 + AAC 48 kHz；
- Record Task 真实进入 `RECORDING`；
- Candidate Manager 重启期间 Record Task 仍保持 `RECORDING`；
- 正常 Stop 后 Task=`COMPLETE`；
- Asset：6 个安全 TS segment，最终 MP4 约 960 KB，时长约 10.97 s；
- ffprobe：H.264 640×360 + AAC 48 kHz。

## Worker 异常重启恢复

- Record Worker 使用进程组硬杀模拟异常退出；
- 旧 Asset 保留 TS segment，并在新 Worker 真正取得 lease 后转为 `RECOVERABLE`；
- Worker instance ID 发生变化，新 Worker 创建第二个 Asset 并恢复 `RECORDING`；
- 正常 Stop 后新 Asset=`COMPLETE`，旧 Asset 继续保留为 `RECOVERABLE`；
- 最终 MP4 ffprobe 仍为 H.264 640×360 + AAC 48 kHz。
## TS / 磁盘预算

- TS Task 真实进入 `RECORDING → COMPLETE`；
- 最终 TS 可被 ffprobe 正常读取，媒体为 H.264 640×360 + AAC 48 kHz；
- 将 `RECORD_MIN_FREE_BYTES` 提升到明显高于实际可用空间后，新 Task 正确进入 `FAILED`；
- Error 明确为 `Insufficient recording storage`，没有创建半成品 Asset。

## 清理与生产复核

- Candidate DB `integrity_check=ok`；
- Field Gate 后 `p5_gate_*` SRS 流为 0；
- Candidate 进程为 0，临时代码、DB、录制目录全部删除；
- 生产 Hook 表中 4 条明确 `p5_gate_%` 测试事件已删除，复核为 0；
- 生产 DB `integrity_check=ok`；
- `srs.service`、Manager、Pull Worker、Push Worker、Transcode Worker 全部保持 active；
- 本轮未进行生产 Record Worker/systemd cutover，正式部署仍留到后续 release/cutover Gate。

结论：**Phase 05 Field Gate PASS**。RECORD 已具备安全分段、正常 Finalize、异常可恢复、Worker lease/restart、真实文件 Evidence、TS/MP4 与磁盘阻断闭环。
