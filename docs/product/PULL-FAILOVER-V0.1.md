# SRS Manager Pull Failover v0.1

> 状态：P3-B 设计基线
> 前置：`PULL-RUNTIME-AND-FLOW-LINKAGE-V0.1.md`

## 1. 目标

把 P3-A 的单一 Managed Pull 升级为可控主备输入，不把“重试同一个坏源”误当作高可用。

第一版原则：

- 一条 PullTask 可以绑定多个 ExternalSource；
- 每个候选源有明确优先级与启用状态；
- 主源持续失败后才切备用，避免瞬时抖动触发切换；
- 备用接管后默认不自动回主源，防止直播过程中来回抖动；
- 回主源先提供人工切换，后续再增加可选稳定窗口自动回切；
- 同一 Stream 仍只允许一个 Managed Pull publisher；
- 第三方 IN-PUSH 占用时仍进入 BLOCKED，自动化不得踢掉外部发布端；
- Worker Lease 仍是唯一执行权，Standby Worker 不得 spawn FFmpeg。

## 2. 数据模型

保留现有 `pull_tasks.external_source_id` 作为兼容字段，不立即删除；新增候选源关系：

```text
pull_task_sources
- id
- pull_task_id
- external_source_id
- priority          1 = 首选，数字越小优先级越高
- enabled           1 / 0
- created_at
- updated_at

UNIQUE(pull_task_id, external_source_id)
UNIQUE(pull_task_id, priority)
```

PullTask 增加运行事实：

```text
active_source_id
last_source_switch_at
last_source_switch_reason
```

已有单源 PullTask 在轻量 migration 中自动写入一条 priority=1 的候选源记录。

## 3. Source Selection

启动时：

1. 读取 enabled 候选源，按 priority 升序；
2. 如果存在 `active_source_id` 且该源仍启用，重启恢复时优先继续该源，避免无原因回切；
3. 否则选择 priority 最小的候选源；
4. 没有候选源则 Runtime=FAILED。

## 4. Failover

每个源维持“当前连续失败计数”，第一版先复用 PullTask `attempt` 作为当前 active source 的连续尝试次数。

建议门槛：

```text
PULL_SOURCE_MAX_ATTEMPTS = 3
```

当前源达到门槛：

```text
当前源失败
→ 查找下一 enabled priority
→ active_source_id 切换
→ attempt 清零
→ runtime_state = RETRYING
→ 记录 switch reason
→ 进入下一源 backoff/start
```

所有候选源均不可用：

```text
runtime_state = FAILED
last_error = all sources exhausted
```

人工 Retry：

- 默认从当前 active source 重试；
- 若当前源不存在/禁用，则选最高优先级 enabled 源。

## 5. 不自动 Failback

当备用源已经 RUNNING：

- 不主动探测后立即抢回 priority=1；
- 不因为主源短暂恢复而中断正在播出的备用源；
- UI 显示“当前由备用源承载”；
- 提供“切换到首选源/切换到指定源”人工 Operation；
- 后续自动回切必须要求单独策略，例如 `stable_for >= 60s`，且默认关闭。

## 6. 人工切源

人工切源不是直接改 `active_source_id` 后就算完成，而是一个受控 Operation：

```text
选择目标 Source
→ 校验目标启用/协议/URL
→ 设置 pending target
→ 停止当前 FFmpeg
→ 当前 publisher 消失
→ 启动目标 Source
→ SRS 观测到 publisher
→ RUNNING
```

第一版可以采用 break-before-make，避免同一 stream 两个 publisher 争抢；后续若要无缝切换需引入专门媒体切换层，不能用两个 FFmpeg 同推一个 SRS stream 冒充无缝。

## 7. UI

Stream Workspace 的 Managed Pull 区域显示：

```text
Managed Pull
Desired: RUNNING
Runtime: RUNNING
Worker: healthy

当前源
● 城市台主源     PRIMARY · RUNNING

候选源
1  城市台主源     PRIMARY
2  城市台备用源   STANDBY
3  公网兜底源     STANDBY

[停止拉取] [切换输入] [...]
```

只有真实 Observed publisher + 当前 Worker ownership 成立时显示绿色 RUNNING。

## 8. 验收

P3-B 第一阶段必须满足：

- 现有单源数据无损迁移为 source set；
- 主源失败不会无限重试同一源；
- 达到阈值后自动切下一候选源；
- 备用接管后默认不自动回切；
- 人工切源改变的是 Desired/Operation，不绕过 Worker；
- 两个 Worker 并存时仍只有 Lease owner 能执行切换；
- 第三方 publisher 占用时不自动踢人；
- API/UI 不泄露 ExternalSource 原始 secret URL；
- Backend regression + Frontend build + Container CI 全部 PASS；
- 实机 SRS + FFmpeg 主源断开→备用接管证据作为独立 Verification Debt，在真实部署环境验证。