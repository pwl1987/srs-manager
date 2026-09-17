# SRS Manager 整改状态

> 本文件是 UI / 工作流 / 流控制整改的当前状态入口。后续新窗口应先核对 live `master` 与本文件，再决定是否推进下一任务；不要根据旧聊天猜进度。

## Current Phase

P3-B — Managed Pull 主备输入与安全切换

## Last Completed

### P0 — 产品与四向流控制模型

已完成：

- IN-PUSH / IN-PULL / OUT-PUSH / OUT-PULL 四类方向；
- 主动/被动连接控制权；
- “断开当前会话”与“禁止未来访问”分离；
- Desired / Runtime / Observed State 分离；
- Stream Graph / 联动基线。

### P1 — UI Shell / Operations Console 第一轮

已完成：

- 专业直播运维控制台定位；
- 分组导航、Header、宽屏工作区、Design Token；
- 登录页与通用控件统一；
- Dashboard → Operations Center 第一轮；
- Frontend CI + i18n/build gate。

### P2 — Stream Workspace

已完成：

- `/streams/:id` 单流工作台；
- Streams 主列表脱离传统宽 CRUD 表；
- Signal Graph；
- Observed / Configured / Unavailable 证据语义；
- publisher / viewer 精确分离控制；
- Workspace 聚合 API；
- SRS streams/clients 分页，避免默认 10 条截断。

### P3-A — Managed Pull 最小 Runtime

代码 / CI / 容器闭环已完成：

- PullTask Desired / Runtime 状态；
- 独立 Pull Worker + FFmpeg；
- retry / backoff / FAILED / BLOCKED；
- SRS publisher 占用冲突不自动踢人；
- Worker heartbeat + 单执行者 Lease；
- Web 与 Pull Worker 双镜像；
- ExternalSource URL 公共 API 脱敏；
- Workspace Start / Stop / Retry / Unbind；
- Node 24 兼容：`better-sqlite3` 升级至 13.x N-API 基线；
- Backend / Frontend / Container CI 门禁。

### P3-B 第一阶段 — 自动主备 Failover

代码 / CI 闭环已完成：

- 一个 PullTask 对多个候选 ExternalSource；
- legacy 单源无损迁移为 priority=1；
- `active_source_id` 与切源原因/时间；
- 多源当前源连续失败达到门槛后向下一优先级 failover；
- 单源保留原总重试预算；
- 备用源接管后默认不自动 failback；
- Source Set API；
- Workspace 展示 Active / Standby / Priority / Enabled；
- 新增/停用/移除备用源；
- Active Source 删除原子化，失败不会留下半修改状态；
- Backend / Container CI PASS。

## Current Task

P3-B 第二阶段 — 人工安全切源 Operation。

目标不是直接修改 `active_source_id`，而是实现 break-before-make 的受控操作：

```text
请求切换目标 Source
→ 校验候选源
→ 记录 Pending Operation
→ Worker 接管 Operation
→ 停止当前 FFmpeg
→ 等待当前 managed publisher 消失
→ 切 active_source_id
→ 启动目标 Source
→ 等待 SRS publisher 重新出现
→ Operation SUCCEEDED / FAILED
```

在该 Operation 完成前，UI 不提供会让用户误以为“已经安全切源”的直接按钮。

## Next Task

P3-C / 四向链路继续收敛：

- Source priority 原子排序；
- 可选稳定窗口自动 failback（默认关闭）；
- OUT-PUSH Desired 与 Runtime/Observed 分离；
- OUT-PULL Access Grant / 禁止新连接 / 断现有连接 / 撤销授权；
- 链路异常联动与告警。

随后进入：

- P4 — Live Event / Template / Preflight；
- P5 — Operation / Reconciler / Alert / Audit；
- P6 — Batch / Runbook / Automation；
- 其余 CDN / DNS / Forwarding / Auth / Settings 页面按新工作流全面整改。

## Verification Debt

以下不能用单元测试或 GitHub Actions 冒充完成：

1. 真实 SRS + FFmpeg：Managed Pull 首次启动并发布到 SRS；
2. 主源真实断开 → 达到失败门槛 → 自动切备用源；
3. 备用源接管后 SRS publisher / OUT-PUSH / OUT-PULL 联动恢复；
4. Pull Worker 容器重启后的 Desired State 恢复；
5. 双 Pull Worker 实机并存时只有 Lease owner 启动 FFmpeg；
6. 用户主动 STOP 后不得自动复活。

这些在真实部署环境取得证据后才能标记 Runtime Verification COMPLETE。

## Current Completion Estimate

按整改阶段与风险权重估算，而非按代码行数：约 **55%**。

已完成的是基础产品模型、主要 UI Shell、Stream Workspace 和 IN-PULL Runtime/自动主备基础；剩余主要工作集中在安全 Operation、OUT-PUSH/OUT-PULL 完整控制、告警/审计/自动化、Live Event/Preflight，以及其余页面的深度工作流整改。