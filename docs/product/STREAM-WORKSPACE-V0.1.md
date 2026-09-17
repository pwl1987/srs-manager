# SRS Manager 单流工作台 v0.1

> 状态：P2 实施基线  
> 目标：把「流管理」从 CRUD 表格升级为围绕单路业务流的运维工作台，同时严格遵守 `STREAM-FLOW-AND-CONTROL-MODEL.md` 中的 IN-PUSH / IN-PULL / OUT-PUSH / OUT-PULL 控制语义。

## 1. 本阶段范围

P2 只解决三件事：

1. 一眼理解一条流当前从哪里来、到哪里去；
2. 对现有 SRS 能力提供精确、不会混淆的控制动作；
3. 把当前散落在 Streams / Forwarding / CDN / Distribution / Monitor 的信息汇总到单流上下文中。

P2 **不**提前实现 Desired State / Reconciler，不做大规模数据库迁移，也不宣称当前已经具备完整 IN-PULL Runtime。尚未有真实运行机制支撑的能力只能标记为「未配置 / 尚未接入」，不能画成绿色运行链路。

## 2. 核心原则

### 2.1 观测状态 / 配置状态分离

Workspace 中所有状态必须注明来源：

- **观测状态（Observed）**：来自 SRS 当前 streams / clients / stats 的实时观测；
- **配置状态（Configured）**：来自 SQLite 中 CDN、Forward、Distribution、Transcode 等配置；
- **不可用（Unavailable）**：当前系统尚无足够证据判断，禁止猜测。

### 2.2 精确控制，不使用模糊“停止”

当前历史接口 `POST /streams/:id/stop` 会枚举并踢掉该流的 publisher 与 player，语义过宽。P2 新增精确动作：

- `disconnect-publisher`：仅主动踢除发布端；
- `disconnect-viewers`：仅主动踢除播放端；
- 历史 `stop` 暂保留兼容，但新 UI 不再作为主操作使用。

注意：断开 publisher 后，SRS 可能因为输入消失自然结束播放会话；这与管理端主动遍历、踢掉所有 player 是两回事，UI 必须明确区分。

### 2.3 直播流是工作上下文，不是数据库行

`/streams/:id` 需要聚合：

- 基础流信息与实时状态；
- Observed ingress（当前发布端）；
- OUT-PUSH（forward tasks）；
- CDN 关联与状态；
- OUT-PULL endpoints；
- Distribution requests；
- 转码模板；
- 最近 SRS hook 事件；
- 当前可执行的控制能力。

## 3. P2 工作台信息结构

```text
Stream Workspace
├─ Hero / Running Summary
│  ├─ LIVE / IDLE
│  ├─ viewers / bitrate / uptime
│  └─ preview / copy / disconnect publisher
├─ Signal Path
│  ├─ INPUT
│  │  └─ Observed IN-PUSH publisher（若存在）
│  ├─ STREAM CORE
│  └─ OUTPUT
│     ├─ OUT-PUSH forward tasks
│     ├─ CDN channels
│     └─ OUT-PULL endpoints / connected players
├─ Endpoints
│  ├─ Publish endpoint
│  └─ HLS / FLV / RTMP / WebRTC pull endpoints
├─ Distribution
├─ Recent Activity
└─ Advanced / Danger Zone
```

## 4. 流向判定规则

### IN-PUSH

当 SRS `/clients` 中存在当前 stream 的 publish client 时，Workspace 显示 Observed `IN-PUSH`：

- state = online
- publisher client id
- publisher IP（若 SRS 提供）
- protocol（若可获得）

没有 publisher 时，只显示「当前未观测到输入」，不能仅根据 streams.protocol 推断当前正在 IN-PUSH。

### IN-PULL

当前仓库的 `external_sources` 尚不足以证明存在一个已经运行、可控制的 pull-ingest Runtime，因此 P2 不把 external source 自动绘制成 IN-PULL 实时链路。后续实现真正 Pull Runtime 后再接入 Signal Graph。

### OUT-PUSH

`forward_tasks` 中与 stream_id 关联的任务作为 Configured OUT-PUSH 展示：

- enabled / disabled
- target_type
- target_url（UI 默认截断）
- status / error_message

### OUT-PULL

系统生成的 HLS / FLV / RTMP / WebRTC 地址作为 OUT-PULL endpoints；SRS 当前非 publish clients 作为已连接 consumers 的观测依据。Distribution Request 属于这些 endpoint 之上的授权/业务分发层。

### CDN

CDN Channel 与 Stream 有明确 stream_id 关系，因此可作为输出资源展示。远端 live state 为 best-effort：第三方状态查询失败时必须显示 unknown，不能把 unknown 当 offline。

## 5. 工作台聚合接口

新增：

```text
GET /api/streams/:id/workspace
```

建议响应：

```json
{
  "stream": {},
  "observed": {
    "online": true,
    "publisher": {},
    "players": { "count": 12 },
    "bitrate": 7200,
    "uptime_seconds": 3600
  },
  "outputs": {
    "forwards": [],
    "cdn_channels": [],
    "pull_endpoints": {}
  },
  "distribution": [],
  "activity": [],
  "capabilities": {
    "disconnect_publisher": true,
    "disconnect_viewers": true,
    "in_pull_runtime": false
  }
}
```

聚合接口以只读为主，第三方查询必须 best-effort，局部失败不能让整个 Workspace 不可用。

## 6. 直播流列表重构

Streams 首页不再以八列数据库表为默认界面，改为运行行 / 运维卡片：

```text
● news-main             LIVE
  RTMP IN → SRS → 2 outputs
  132 viewers · 7.3 Mbps · 02:18:43
                       [预览] [工作台] [...]
```

首屏只暴露高频动作；编辑、删除等低频/危险动作降低视觉权重。详情、分发和链路分析全部进入 Workspace。

## 7. 人因约束

- 绿色只表示已观测正常，不能表示“已配置”；
- unknown 与 offline 必须视觉不同；
- 危险动作必须解释影响范围，而不只问“确定吗”；
- URL 默认可复制但不抢占主要视觉；
- 一条流的常规操作尽量不离开 `/streams/:id`；
- 任何自动推断都必须能追溯到数据来源。

## 8. P2 验收

1. Streams 首页不再是传统 CRUD 主表；
2. 每条流可进入独立 Workspace；
3. Workspace 能同时看见输入、核心流、OUT-PUSH、CDN、OUT-PULL、分发和活动；
4. 新 UI 不再调用语义模糊的 legacy `/stop`；
5. publisher / viewers 可被分别控制；
6. IN-PULL 未实现时明确显示为能力未接入，不伪造运行状态；
7. 前端 production build + i18n 校验通过；
8. 后端新增文件至少通过 Node syntax gate。