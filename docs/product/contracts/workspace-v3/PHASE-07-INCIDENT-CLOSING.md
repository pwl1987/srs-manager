# Workspace V3 Phase 07 — Incident / Health / Closing

状态：**COMPLETE**

Phase 07 不建立第二套监控真相。Incident 只消费已经存在的 Desired / Runtime / Observed / Capability / Session importance，并把技术事实翻译为业务影响。

## Incident Authority

- 分类：`SIGNAL / DELIVERY / RESOURCE / SYSTEM`；
- 生命周期：`OPEN → ACKNOWLEDGED → RECOVERED`；
- `ACKNOWLEDGED` 仅表示操作员已经看到，不代表故障恢复；
- 恢复必须由对应 Health Reason 消失后自动形成 `RECOVERED`；
- Incident 固定包含：发生了什么、影响哪些 Output、Program 是否受影响、当前还能否播、建议动作；
- Required Output 的真实失败可以把局部 WARNING 提升为业务 CRITICAL，但不得声称 Program 已丢失；
- Rendition 故障只传播到引用该 Rendition 的 Output；
- Resource/System 故障按真实依赖链传播，禁止“一处红、全局红”。

## Closing Authority

收播固定按以下顺序执行：

1. 停止 Session 内受管网络 PUSH / SERVE admission；
2. 等待 RECORD 停止并完成 Finalize；
3. 停止 Managed Pull；
4. 仅在计划内 Runtime 均已收敛后把 Session 转为 `ENDED`。

任何阶段存在失败或超时，Session 保持 `CLOSING`，Operation 返回残留事实，不允许假装 ENDED。

外部 IN-PUSH Publisher 不由收播编排自动断开；SERVE 的 admission stop 也不等同于关闭 SRS 原生直连 HLS，这两个边界继续显式展示。

## Workspace

生产 Workspace 已接入：

- Session Command Bar 的“结束本场直播 / 继续收播”；
- Operations Dock：Incidents / Events / Operations / Resources；
- Incident ACK；
- Recovered 最近记录；
- Worker / Record Storage 摘要；
- 收播 Operation 轮询与失败残留提示。

Phase 08 只负责最终 16:9 Cutover、空间密度、人因计时复核与 Legacy 入口审计，不再重写本阶段 Incident/Closing 语义。
