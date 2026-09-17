# SRS Manager Pull Runtime 与四向链路联动 v0.1

> 状态：P3 设计基线 / Draft  
> 前置：`STREAM-FLOW-AND-CONTROL-MODEL.md`、`STREAM-WORKSPACE-V0.1.md`  
> 目标：把 IN-PULL 从“配置表单”升级为真正可启动、可停止、可重试、可观测的运行时，并明确它与 IN-PUSH / OUT-PUSH / OUT-PULL 的联动边界。

## 1. 已确认的 SRS 能力边界

SRS 原生能力适合继续承担媒体核心，而不是业务控制器：

- SRS Dynamic Forward 可以在发布流出现时向业务后端查询 OUT-PUSH 目标；当前仓库 `/api/forward` 已处在正确方向。
- SRS Ingest 本质上通过 FFmpeg/外部工具拉取 RTMP/RTSP/HTTP/HLS 等来源，再发布回 SRS。
- 现代 SRS HTTP RAW API 不适合作为日常动态 Ingest 控制面：配置写入能力已被收缩，主要保留 reload。
- SRS HTTP API 很适合继续承担 Observed State：streams / clients / kickoff client。

参考：

- https://ossrs.io/lts/en-us/docs/v5/doc/forward
- https://www.ossrs.io/lts/en-us/docs/v6/doc/ingest
- https://www.ossrs.io/lts/en-us/docs/v5/doc/http-api
- https://ossrs.io/lts/en-us/docs/v8/doc/http-api

因此 P3 选择：**独立 Pull Worker 管理 IN-PULL；SRS 继续作为汇聚、分发和实时观测核心。**

## 2. 为什么不能继续复用当前 external_sources 假装“拉流已实现”

当前 `external_sources` 只是来源配置，`forward_tasks` 是 SRS 流出现后的 OUT-PUSH 目标。二者之间没有一个真实的拉流进程生命周期。

如果 UI 仅因为存在 external_source 就显示“正在拉流”，会把 Configured State 冒充 Observed State，并造成以下问题：

- 不知道 FFmpeg 是否真的启动；
- 不知道第三方地址是否可达；
- 不知道拉流是否已经发布回 SRS；
- 无法可靠停止、重试或熔断；
- Manager 重启后无法恢复运行状态；
- 无法处理 IN-PUSH 与 IN-PULL 同时抢占同一 stream 的冲突。

所以 external_source 继续只代表“Source Definition”，运行状态必须由单独 Runtime Task 表达。

## 3. P3 领域模型

```text
ExternalSource              Stream
     │                         │
     └────── PullTask ─────────┘
                │
          Desired State
                │
          Pull Worker
                │
             FFmpeg
                │
          publish to SRS
                │
         Observed IN-PULL
                │
        ┌───────┴────────┐
     OUT-PUSH          OUT-PULL
   Dynamic Forward   HLS/FLV/RTMP
```

新增一等对象 `PullTask`：

```text
id
stream_id
external_source_id
desired_state        RUNNING | STOPPED
runtime_state        STOPPED | STARTING | RUNNING | RETRYING | FAILED | BLOCKED
attempt
last_error
last_started_at
last_stopped_at
next_retry_at
worker_instance_id
created_at
updated_at
```

不把 OS PID 当作系统事实长期持久化；PID 只在 Worker 内存中用于当前进程控制。数据库保存的是可恢复的业务状态。

## 4. Pull Worker 定位

Pull Worker 是独立进程/容器，不与 Express Web 进程共用子进程生命周期。

建议部署：

```text
srs-manager-web
    └─ Express / React / SQLite control plane

srs-manager-pull-worker
    └─ Node worker + FFmpeg

SRS
    └─ media runtime
```

Web 与 Worker 可共享 SQLite WAL 数据卷，但 Worker 只负责 PullTask 生命周期，不处理 UI 请求。

### 为什么不直接在 Express 中 spawn FFmpeg

- Web 进程重启会丢失子进程监督；
- HTTP 请求生命周期不应等同于媒体任务生命周期；
- 后续多路拉流、退避、主备、资源限制都会污染 Web 进程；
- 独立 Worker 更容易做健康检查、升级、限流和崩溃恢复。

## 5. FFmpeg 启动约束

必须使用 `spawn(binary, args)`，禁止拼接 shell command。

Source URL 只能来自经过协议白名单和 URL 校验的 ExternalSource。第一阶段建议支持：

```text
rtmp / rtmps / rtsp / http / https / srt
```

默认优先 passthrough / remux，不在 Pull Worker 中偷偷改变画质。无法 copy 的编码组合进入 FAILED，并提示需要显式转码策略；不要自动开启昂贵转码。

输出固定发布回受控 SRS stream endpoint：

```text
rtmp://<srs-runtime>/live/<stream-name>
```

后续如需 SRT publish，可作为 runtime adapter 增加，不改变 PullTask 契约。

## 6. Desired / Runtime / Observed 三态分离

P3 开始不能再只有一个 status 字段。

例如：

```text
Desired: RUNNING
Runtime: RUNNING
Observed SRS publisher: ONLINE
=> HEALTHY
```

```text
Desired: RUNNING
Runtime: RETRYING
Observed SRS publisher: OFFLINE
=> DEGRADED
```

```text
Desired: STOPPED
Runtime: STOPPED
Observed publisher: ONLINE (第三方仍在推)
=> OWNERSHIP CONFLICT
```

UI 最终状态必须由三种证据组合得出，不能用单字段覆盖事实。

## 7. 输入所有权与冲突

同一业务 Stream 第一阶段只允许一个“受控主输入所有者”。

建议 ownership：

```text
EXTERNAL_PUSH
MANAGED_PULL
NONE
```

当 PullTask 希望 RUNNING，但 SRS 已观测到非 Worker 所属 publisher 时：

- 不直接踢掉第三方 publisher；
- PullTask 进入 BLOCKED；
- UI 显示“输入占用冲突”；
- 人工选择后续策略。

这是为了避免自动化把真实直播源错误踢下线。

Worker 自己发布到 SRS 时必须携带可识别标记（token/query metadata 或受控来源信息），让 Hooks / Workspace 可以把 Managed Pull 与普通 IN-PUSH 区分开。

## 8. 重试与熔断

第一阶段建议：

```text
attempt 1: 1s
attempt 2: 2s
attempt 3: 4s
attempt 4: 8s
attempt 5+: 15s~30s + jitter
```

同时满足：

- Worker 进程退出不立即无限快速拉起；
- 用户主动 STOP 后绝不自动重试；
- 配置变更后清零退避并重新验证；
- 连续失败达到阈值进入 FAILED / OPEN CIRCUIT，需要人工重试或等待策略恢复；
- 日志只记录脱敏后的 URL，禁止把 URL 中用户名、密码、token 原样写入。

具体数值作为策略配置，不能散落在 UI 中。

## 9. 四方向联动

### IN-PULL 启动成功

```text
PullTask Desired RUNNING
→ Worker STARTING
→ FFmpeg connects source
→ FFmpeg publishes SRS
→ SRS on_publish
→ Workspace observed publisher
→ Stream ONLINE
→ SRS Dynamic Forward 查询 OUT-PUSH targets
→ OUT-PUSH 自动建立
→ OUT-PULL endpoints 可被消费
→ CDN / viewers 状态进入观测
```

### IN-PULL 来源中断

```text
FFmpeg exits / source timeout
→ Runtime RETRYING
→ SRS on_unpublish
→ Stream OFFLINE/DEGRADED
→ OUT-PUSH 随源消失自然停止
→ OUT-PULL 没有媒体数据
→ Alert / Timeline
→ backoff retry
```

### 用户主动停止 IN-PULL

```text
Desired STOPPED
→ Worker SIGTERM
→ grace timeout
→ SIGKILL only if needed
→ Runtime STOPPED
→ no retry
→ SRS publisher disappears
→ downstream naturally drains
```

“停止拉取”和“断开第三方播放端”仍然是两个完全不同的动作。

## 10. OUT-PUSH 状态模型

现有 `forward_tasks.enabled` 只能表示 Configured Desired State，不能直接表示正在转推。

P3 应逐步拆成：

```text
enabled / desired_state
runtime_state
last_error
last_observed_at
```

SRS Dynamic Forward 后端返回某个 target 只能证明“配置被提供给 SRS”，不能单独证明远端平台已经持续接收到媒体。若 SRS 没有足够的 per-target telemetry，则 UI 必须标记为 Configured / Requested，而不是虚构 HEALTHY。

## 11. OUT-PULL 控制边界

P3 仍不把“断开 viewers”误称为“停止 OUT-PULL”。

真正的 OUT-PULL 管理需要 Access Grant / Policy：

```text
Endpoint exists
+ Grant valid
+ New connection allowed
+ Existing session handling policy
```

因此：

- `disconnect-viewers` 只是当前会话动作；
- “禁止继续拉流”必须在鉴权/Access Grant 层实现；
- 该能力后续与分发申请合并，不在 P3 用踢客户端冒充。

## 12. 安全与隐私

ExternalSource URL 可能包含第三方账号、签名和 token：

- API 默认返回 masked URL；
- UI 默认只显示 host / scheme / path 摘要；
- Worker 日志必须 redact userinfo、query token、签名参数；
- PullTask 不复制保存 source secret；只引用 external_source_id；
- FFmpeg 参数禁止经过 shell；
- URL 必须阻止本地敏感地址/SSRF 风险，复用并加强现有 URL validation。

## 13. 部署要求

当前 manager 镜像只有 Node + curl，没有 FFmpeg，因此 Pull Worker 必须显式引入媒体 runtime，而不能假设宿主机工具可见。

建议：

- 为 Pull Worker 单独 Docker stage/image 安装固定版本 FFmpeg；
- Web 镜像保持轻量，不安装 FFmpeg；
- Compose 增加 pull-worker service；
- 明确 Worker → SRS 的内部地址，不依赖浏览器可见地址；
- Web / Worker 共享 `/app/data`，SQLite 保持 WAL。

## 14. P3 实施顺序

1. 数据契约：`pull_tasks` + migration + service；
2. URL 安全与脱敏；
3. Pull Worker 单任务 supervisor；
4. Worker ↔ SRS publish 与 Observed ownership；
5. Start / Stop / Retry API；
6. Workspace 接入 IN-PULL 节点与状态；
7. 外部来源页面从“拉流转发混合页”拆成 Source / Pull Task / OUT-PUSH；
8. 故障退避、恢复和回归测试；
9. 实机 SRS + FFmpeg 验证后再开放自动化策略。

## 15. P3 第一阶段验收

- IN-PULL 必须有真实 FFmpeg 进程与 SRS publisher 双证据；
- Web 重启不丢 Desired State，Worker 能恢复；
- 用户 STOP 后不自动复活；
- 第三方 IN-PUSH 占用同流时不自动踢人，进入 BLOCKED；
- Source URL 不在普通 API / 日志中裸露凭证；
- OUT-PUSH / OUT-PULL 仍保持各自控制语义；
- 任何“绿色运行”必须能追溯到真实 Observed State。
