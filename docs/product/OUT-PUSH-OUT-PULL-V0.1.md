# SRS Manager 主动外推与拉流授权控制 v0.1

状态：v0.4 实施基线。

## 1. 目标

P3-C 把剩余两类输出链路从“配置项”升级为可执行控制面：

- `OUT-PUSH`：我方主动把当前 SRS 流推给第三方；
- `OUT-PULL`：第三方主动从我方 SRS Origin 拉流。

核心原则仍然是：**期望状态、运行状态和真实观测证据分离；停止必须改变真正的控制面，而不是只改数据库标签。**

## 2. OUT-PUSH：为什么不继续依赖 Dynamic Forward

SRS Dynamic Forward 的 backend 回调适合在 Publisher 建立时查询转推目标，但它不是完整的运行时控制器。数据库里把任务改成“禁用”，不能可靠等价为立即终止一个已经建立的 Forward。

因此 v0.4 将新 OUT-PUSH 任务统一交给独立 `Push Worker`：

```text
SRS 当前流
   ↓
Push Worker / FFmpeg
   ↓
RTMP / RTMPS / SRT 第三方目标
```

旧 Dynamic Forward 接口仅保留兼容能力，并且只返回明确标记为 `srs_dynamic` 的历史任务，避免与受管 Worker 双推。
## 3. OUT-PUSH 状态模型

每个外推任务保存：

- `Desired State`：`RUNNING / STOPPED`；
- `Runtime State`：`STOPPED / WAITING_INPUT / STARTING / RUNNING / RETRYING / FAILED / STOPPING`；
- `Worker Lease`：保证同一时刻只有一个 Push Worker 执行任务；
- `attempt / next_retry_at / last_error`：用于退避与故障诊断。

关键语义：

- 没有 SRS 输入时，任务进入 `WAITING_INPUT`，不会盲目启动 FFmpeg；
- 输入出现后才允许启动外推；
- 输入消失时立即停止本地外推进程并回到 `WAITING_INPUT`；
- 用户 Stop 会把 Desired State 改为 `STOPPED` 并真正终止 FFmpeg；
- `RUNNING` 只证明受管 FFmpeg 进程持续工作且本地输入仍在线，**不代表第三方平台已经健康播放**。

目标 URL 普通 API 只返回脱敏值；包含账号、密码、签名或查询参数的完整地址只在 Worker 内部读取。

## 4. OUT-PULL 四个独立动作

第三方拉流不是我方主动建立的连接，因此控制对象不是“一个本地进程”，而是端点、准入、授权和现有会话：

1. **端点可用 / 关闭端点**：决定新的 SRS Origin 播放请求是否可进入；
2. **允许 / 暂停新连接**：用于维护窗口或临时冻结，不主动踢已有会话；
3. **访问授权**：可要求有效 Access Grant 才允许新播放连接；
4. **断开当前会话**：显式调用 SRS client kickoff，与前面三个动作分离。

“吊销授权”只阻止后续使用该授权建立连接，**不会假装已经断开现有会话**。
## 5. Access Grant 安全模型

Access Grant 保存业务元数据和 token 哈希：

```text
grant_id
stream_id
label
token_hash
token_hint
status
valid_from
expires_at
created_by
revoked_at
```

完整 bearer token 只在创建时返回一次，数据库不保存明文。控制台后续只显示尾部提示字符和有效期。

播放请求通过 SRS `on_play` Hook 进入准入判断：

```text
Endpoint Enabled?
   ↓
Accepting New Sessions?
   ↓
Require Grant?
   ↓ yes
access_token 是否有效、未过期、未吊销？
   ↓
允许 / 拒绝
```

未登记到 SRS Manager 的历史流继续保持原有开放行为，避免升级时意外中断既有业务。

## 6. 内部媒体凭证

Push Worker 自己也要作为播放器从 SRS Origin 取当前流，因此同样会触发 `on_play`。

系统使用内部媒体凭证区分受管 Worker 与外部第三方：

- 首次使用时在共享 SQLite `settings` 中随机生成；
- 使用事务保证 Web 与 Worker 并发启动时只形成一个真实值；
- 不写入 README、Compose、UI 或普通日志；
- Push Worker 拉取 SRS 时携带内部凭证；
- `on_play` 仅在凭证精确匹配时绕过外部 OUT-PULL 策略。

这样开启“需要授权”不会把自家的 OUT-PUSH Worker 一并阻断。
## 7. 控制范围边界

OUT-PULL 策略当前明确控制 **SRS Origin 直连入口**。如果客户端使用网宿等第三方 CDN 域名，CDN 鉴权必须在供应商侧单独配置和验证；控制台不得把 Origin 授权状态冒充成 CDN 已受保护。

同理，OUT-PUSH `RUNNING` 不是远端平台健康探测。后续如果供应商提供可靠状态 API，可以作为额外 Observed Evidence 接入，但不能用本地进程存活替代。

## 8. v0.4 验收

自动门禁必须覆盖：

- v0.3 旧 `forward_tasks` 数据无损迁移；
- OUT-PUSH Desired / Runtime 分离；
- Push Worker Lease 互斥；
- OUT-PUSH 目标 URL 普通 API 脱敏；
- RTMP/RTMPS 与 SRT 输出参数正确；
- Dynamic Forward 不返回 Managed Worker 任务，避免双推；
- `on_play` 在需要授权时真实拒绝无效播放；
- Access Grant 数据库只保存哈希；
- 吊销授权不伪装成“当前会话已断开”；
- Workspace 同时展示 Managed Pull、Managed Push 与 OUT-PULL 策略。

真实环境还需补充：一路真实输入 → OUT-PUSH 到第三方测试端、停止后立即断推、输入消失后进入 WAITING_INPUT、带/不带 Grant 的 Origin 播放准入、断开当前播放会话。
