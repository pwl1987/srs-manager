# SRS Manager 流向与控制模型 v0.1

> 状态：设计基线 / Draft  
> 目标：先统一“流从哪里来、到哪里去、谁掌握主动权、如何切断、如何联动”的产品与系统模型，后续 UI、工作流、自动化、监控、告警、审计均以此为基础继续讨论和收敛。

## 1. 为什么先定义流向模型

SRS Manager 不能只按“Streams / CDN / Forwarding / Distribution / Monitor”这些功能模块组织。对实际运维人员来说，真正关心的是一条媒体流的生命周期：

1. 信号从哪里进入系统；
2. 当前由谁主动建立连接；
3. 系统是否有权主动切断；
4. 信号从哪里输出；
5. 第三方如何获得信号；
6. 一处状态变化后，其他关联链路应该如何联动；
7. 出现异常时，是自动恢复、禁止重连、阻断输出，还是仅告警。

因此，后续所有页面和后端机制应围绕“流向 + 控制权 + 生命周期 + 联动”建立，而不是简单围绕 CRUD 对象建立。

---

## 2. 四类基础流向

整个系统先统一成四种最基础的媒体链路类型。

| 方向 | 建链主体 | 含义 | 示例 | 本系统控制能力 |
|---|---|---|---|---|
| **IN-PUSH** | 第三方主动 | 第三方把流推给我 | 摄像机/编码器/第三方平台 RTMP、SRT Caller 推入 SRS | 可拒绝、踢断、封禁、限权；是否重连由对方决定 |
| **IN-PULL** | 我方主动 | 我主动拉取第三方流 | 拉第三方 RTMP/HLS/SRT/RTSP 信号作为输入源 | 可启动、停止、重试、切换、熔断；主动权在我方 |
| **OUT-PUSH** | 我方主动 | 我主动把流推给第三方 | Forward 到抖音、视频号、网宿、合作平台、自建 SRS | 可启动、停止、重试、切断、切换目标；主动权在我方 |
| **OUT-PULL** | 第三方主动 | 我提供拉流地址，第三方来拉 | 提供 HLS/FLV/RTMP/SRT Listener 地址给合作方 | 可停止服务、吊销授权、禁播、封禁客户端；是否再次拉取由对方决定 |

这四类链路不能只作为 UI 标签，而要成为后端领域模型中的一等概念。

建议统一枚举：

```text
IN_PUSH
IN_PULL
OUT_PUSH
OUT_PULL
```

其中：

- `IN_*` 解决“信号如何进入”；
- `OUT_*` 解决“信号如何出去”；
- `*_PUSH` / `*_PULL` 决定“谁主动建立连接”；
- “谁主动建立连接”进一步决定系统可采用的切断、恢复、禁用和联动策略。

---

## 3. 输入方向：采集信号模型

### 3.1 IN-PUSH：第三方推给我

典型场景：

```text
编码器 / 摄像机 / 第三方平台
          │
          │ 主动 PUSH
          ▼
       SRS Manager / SRS
```

此时我方不是连接发起者。

系统可以主动做：

- 拒绝新连接；
- 对当前 publisher 执行 kick / disconnect；
- 禁用该 Stream 的 publish 权限；
- 吊销或轮换推流密钥；
- 封禁来源 IP / Credential / Stream Key；
- 设置“禁止自动恢复接入”的维护状态；
- 将下游输出同时进入暂停/阻断状态。

但要明确：

> **踢断当前连接，不等于停止第三方继续重连。**

因此 IN-PUSH 的“停止”必须至少区分两类操作：

```text
Disconnect Now
    只踢断当前 publisher

Disable Ingest
    阻止该输入继续接入，直到人工或策略重新启用
```

否则 UI 上一个简单的“停止流”按钮会造成控制语义不明确。

### 3.2 IN-PUSH 推荐状态

```text
DISABLED
WAITING
CONNECTING / AUTHENTICATING
LIVE
DEGRADED
DISCONNECTED
BLOCKED
ERROR
```

其中 `WAITING` 很重要：

> 系统已经允许接入，但第三方尚未推流，这不是故障。

---

## 4. 输入方向：我主动拉第三方

### 4.1 IN-PULL

典型场景：

```text
第三方媒体源
     ▲
     │ 我方主动 PULL
     │
SRS Manager / Pull Worker
```

这种模式主动权在我方，因此系统应该具备完整生命周期控制：

```text
Start
Stop
Restart
Retry
Backoff
Failover
Circuit Break
Health Probe
```

不应只把它理解成一个 `source_url` + `enabled` 字段。

### 4.2 拉流状态建议

```text
DISABLED
SCHEDULED
STARTING
CONNECTING
LIVE
DEGRADED
RETRYING
FAILED
STOPPING
STOPPED
```

### 4.3 拉流停止的语义

`Stop` 必须意味着：

1. 停止当前拉流连接；
2. 关闭自动重试；
3. 更新 Desired State 为 `STOPPED`；
4. 根据联动策略决定下游 OUT-PUSH / OUT-PULL 如何处理；
5. 记录操作人与原因。

而不是单纯杀掉一个进程，之后 watchdog 又自动把它拉起来。

---

## 5. 输出方向：我主动推给第三方

### 5.1 OUT-PUSH

典型场景：

```text
SRS Manager / SRS
       │
       │ 主动 PUSH
       ▼
第三方平台 / CDN / 合作方
```

这种模式我方掌握完整连接主动权。

应支持：

- Start / Stop / Restart；
- 单目标切断；
- 批量切断；
- 自动重试；
- 指数退避；
- 最大失败次数；
- 主备目标切换；
- 输出健康检查；
- 失败降级；
- 手动维护锁；
- Schedule；
- 与上游输入状态联动。

### 5.2 OUT-PUSH 不应与 Stream 本体混为一谈

同一输入流可能同时有多个输出：

```text
News01
  │
  ├─ OUT-PUSH → 网宿 CDN
  ├─ OUT-PUSH → 第三方媒体 A
  ├─ OUT-PUSH → 第三方媒体 B
  └─ OUT-PUSH → 备用 SRS
```

因此“停止输出 A”不能等同于“停止 News01”。

后续 UI 必须明确作用范围。

---

## 6. 输出方向：第三方拉我的流

### 6.1 OUT-PULL

典型场景：

```text
SRS Manager / SRS
       ▲
       │ 第三方主动 PULL
       │
第三方平台 / 客户端 / 合作单位
```

这种模式下，我方无法像 OUT-PUSH 一样“停止一个我主动建立的连接”来完成控制。

真正的控制对象应该是：

```text
Availability
Authorization
Entitlement
Endpoint
Session
```

即：

- 是否继续提供这个拉流端点；
- 哪些主体有权拉；
- 授权何时到期；
- 是否允许新 Session；
- 是否强制断开现有 Session；
- 是否允许断开后重新连接。

### 6.2 OUT-PULL 的“停止”至少拆成四个动作

```text
1. Stop Accepting New Sessions
   停止接受新的拉流连接

2. Disconnect Current Sessions
   断开当前已连接客户端

3. Revoke Access
   吊销 Token / Key / Distribution Grant

4. Disable Endpoint
   完全关闭该输出端点
```

这四者不能在 UI 中都叫“停止”。

---

## 7. 联动模型：不要只控制单条链路

一条业务流应该抽象为一个 `Stream Graph / Signal Graph`：

```text
                    ┌─ OUT-PUSH → CDN A
                    ├─ OUT-PUSH → Platform B
IN-PUSH / IN-PULL ──┤
                    ├─ OUT-PULL → HLS
                    ├─ OUT-PULL → FLV
                    └─ OUT-PULL → Partner Grant
```

所有操作都应明确：

- 操作对象；
- 作用范围；
- 是否向上游传播；
- 是否向下游传播；
- 是否允许自动恢复；
- 是否影响新连接；
- 是否影响现有连接。

---

## 8. 联动策略建议

### 8.1 输入消失

当 `IN-PUSH` 或 `IN-PULL` 进入非 LIVE 状态时：

默认：

```text
Input Lost
   ↓
标记 Stream = DEGRADED / OFFLINE
   ↓
OUT-PUSH：进入 WAITING_INPUT，不盲目持续重建输出
   ↓
OUT-PULL：Endpoint 可以保持，但返回离线/占位/明确不可用状态
   ↓
产生 Alert + Timeline Event
```

可配置高级策略：

```text
KEEP_ENDPOINT
STOP_OUTPUTS
FAILOVER_INPUT
PLAY_SLATE
PLAY_LAST_FRAME
PLAY_BACKUP_STREAM
```

### 8.2 人工停止输入

人工执行 `Disable Ingest` / `Stop Pull` 时，应弹出影响分析：

```text
该输入当前关联：
- 2 个 OUT-PUSH
- 3 个 OUT-PULL Endpoint
- 1 个 Distribution Grant
- 当前观众 312

停止输入后：
- OUT-PUSH 将进入 WAITING_INPUT
- 新 OUT-PULL Session 将按策略拒绝/返回占位流
- 已有 Session 将按策略保留或断开
```

这比简单的“确定停止吗？”更符合专业运维要求。

### 8.3 人工停止整个业务流

需要定义一个真正的高级动作：

```text
Stop Stream
```

它不是简单杀 publisher，而是执行一个受控 Operation：

```text
1. Freeze auto-recovery
2. Stop / block ingest
3. Stop OUT-PUSH
4. Stop accepting OUT-PULL
5. Optional: disconnect existing viewers
6. Revoke temporary distribution grants
7. Stop temporary forwarding
8. Record final state
9. Enter STOPPED / MAINTENANCE
```

这个动作必须支持 Dry Run / Impact Preview。

---

## 9. Desired State / Observed State

后续后端建议正式引入双状态模型。

例如：

```text
Stream: news01

Desired State
  ingest.enabled        = true
  out_push.cdn.enabled  = true
  out_pull.hls.enabled  = true

Observed State
  ingest                = LIVE
  out_push.cdn          = FAILED
  out_pull.hls          = HEALTHY
```

系统因此可以明确知道：

> CDN 输出发生 Drift，需要告警或自动修复。

对于人工 `Stop`：

必须修改 Desired State，防止后台自动恢复机制把它重新启动。

---

## 10. Control Ownership：谁掌握主动权

建议每条 Connection / Endpoint 保存：

```text
connection_direction
  IN | OUT

connection_mode
  PUSH | PULL

initiator
  LOCAL | REMOTE

control_owner
  LOCAL | REMOTE | SHARED
```

其中最关键的是 `initiator` 和 `control_owner`。

例如：

### 第三方推我

```text
direction      = IN
mode           = PUSH
initiator      = REMOTE
control_owner  = SHARED
```

我能踢断和封禁，但不能控制对方是否尝试再次连接。

### 我拉第三方

```text
direction      = IN
mode           = PULL
initiator      = LOCAL
control_owner  = LOCAL
```

### 我推第三方

```text
direction      = OUT
mode           = PUSH
initiator      = LOCAL
control_owner  = LOCAL
```

### 第三方拉我

```text
direction      = OUT
mode           = PULL
initiator      = REMOTE
control_owner  = SHARED
```

我控制授权和 Endpoint，对方控制是否发起拉流。

---

## 11. Access Grant：为 OUT-PULL 增加正式授权对象

目前“分发申请”后续不建议继续只看成一张申请表。

建议升级成：

```text
Distribution Request
        ↓ approved / created
Access Grant
        ↓
OUT-PULL Endpoint / Credential
```

一个 `Access Grant` 至少包含：

```text
grant_id
stream_id
applicant
purpose
protocol
endpoint
auth_mode
credential_ref
valid_from
expires_at
max_sessions
ip_policy
status
created_by
revoked_by
```

这样“第三方拉我的流”就进入可治理生命周期，而不是只发出去一个 URL 后失去控制。

---

## 12. UI 初步表达

单路流工作区建议直接显示拓扑：

```text
输入

● 第三方推流
  IN-PUSH
  LIVE
  Publisher: 10.1.2.3
  [断开当前连接] [禁止继续推流]

                    ↓

               News01

                    ↓

输出

● 网宿 CDN
  OUT-PUSH
  LIVE
  [停止推送]

● 第三方 A
  OUT-PUSH
  LIVE
  [停止推送]

● HLS 分发
  OUT-PULL
  27 sessions
  [停止新连接] [断开当前连接] [吊销授权]
```

UI 必须把：

- 方向；
- 主动方；
- 当前状态；
- 控制动作；
- 影响范围；

放在同一个上下文中。

---

## 13. 统一操作语义

禁止继续用模糊的通用 `Start / Stop` 覆盖所有情况。

建议统一动作词：

```text
IN-PUSH
  Enable Ingest
  Disable Ingest
  Disconnect Publisher
  Block Publisher

IN-PULL
  Start Pull
  Stop Pull
  Restart Pull
  Retry Now
  Switch Source

OUT-PUSH
  Start Push
  Stop Push
  Restart Push
  Switch Target

OUT-PULL
  Enable Endpoint
  Disable Endpoint
  Accept New Sessions
  Stop New Sessions
  Disconnect Sessions
  Revoke Grant
```

对于用户界面可以翻译成自然中文，但领域动作名必须保持精确。

---

## 14. Operation 与审计

所有可能影响在线业务的动作统一生成 `Operation`：

```text
Operation
  id
  type
  target
  scope
  requested_by
  reason
  started_at
  completed_at
  before_state
  desired_state
  after_state
  result
  rollback_state
```

例如：

```text
STOP_STREAM
DISABLE_INGEST
DISCONNECT_PUBLISHER
STOP_OUT_PUSH
REVOKE_OUT_PULL_GRANT
DISCONNECT_VIEWERS
SWITCH_INPUT
FAILOVER_OUTPUT
```

这样后续 UI 才能提供可靠的 Timeline、审计、撤销/恢复和故障分析。

---

## 15. v0.1 先冻结的原则

当前阶段先冻结以下设计原则，具体字段和实现后续继续讨论：

1. **所有媒体链路先归入 IN-PUSH / IN-PULL / OUT-PUSH / OUT-PULL 四类。**
2. **输入/输出方向与 PUSH/PULL 建链方式必须分开建模。**
3. **必须识别连接主动方，不能把“断开连接”误当成“禁止再次连接”。**
4. **我方主动建立的链路允许 Start/Stop/Retry/Failover 全生命周期控制。**
5. **远端主动建立的链路重点控制 Admission、Authorization、Session 和 Reconnect Policy。**
6. **Stream 是业务主对象，输入和多个输出组成 Signal Graph。**
7. **任何状态改变必须经过联动策略，而不是只改当前对象。**
8. **人工 Stop 必须同步 Desired State，避免 watchdog/reconciler 自动复活。**
9. **OUT-PULL 必须最终纳入 Access Grant 生命周期管理。**
10. **高风险操作必须提供 Impact Preview + Audit。**
11. **复杂动作最终进入 Operation 状态机。**
12. **后续 UI、工作流和自动化先围绕这套模型继续推演，再进入大规模实现。**

---

## 16. 下一轮需要继续讨论的问题

v0.1 暂不强行定死，下一轮重点继续收敛：

- 一个 Stream 是否允许多个输入同时存在，以及主/备/候补模型；
- IN-PULL 与 IN-PUSH 的自动切换规则；
- 输入断流后的 Slate / Backup / Black / Freeze Frame 策略；
- OUT-PULL 已有客户端是否默认强制断开；
- Distribution Request → Access Grant 的审批/授权模型；
- 临时直播和永久频道的生命周期差异；
- CDN Channel 与 OUT-PUSH 的领域关系；
- Forwarding 是否统一并入 Signal Graph；
- Transcode 应作为节点还是 Stream Profile；
- 自动恢复和人工维护锁的优先级；
- Failover、Retry、Circuit Break 的默认门槛；
- 最终在 Stream Workspace 中如何用最少交互表达整个拓扑与控制权。

这份文档作为后续产品、UX、后端状态机与自动化讨论的第一版共同基线。
