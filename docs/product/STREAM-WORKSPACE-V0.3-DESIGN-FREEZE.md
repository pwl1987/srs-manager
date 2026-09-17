# SRS Manager Workspace V3 设计冻结基线

> 状态：DESIGN FREEZE  
> 前置实现：v0.5.1 Workspace V2  
> 原则：本文件只冻结已确认产品设计，不代表这些能力已经实现。

## 1. 核心领域模型

Workspace V3 的稳定业务主链为：

```text
Room
  ├─ Sources *
  ├─ Run Plans *
  └─ Sessions *
        ↓
Source Selector
        ↓
唯一 Program
        ↓
共享 Renditions
        ↓
Outputs *
```

当前版本明确保持“多 Source、一选一 Program”，不进入多画面合成、混音、画中画和导播制作域。

## 2. Source / Program

Source 是长期可登记的输入来源，至少支持 PUSH / PULL 两类采集。PUSH 使用稳定 Ingest Endpoint + 独立 Credential；不同设备不得默认争抢同一业务流地址。

Source 可承担 PRIMARY / BACKUP / REMOTE / TEMP / EMERGENCY 等角色，但角色不是采集类型。多个 Source 可以同时 Ready，任意时刻只有一个成为 Program。

切源必须经过可观测状态：`PRECHECK → SWITCHING → VERIFYING → PROGRAM`。旧 Program 健康时，新源切换失败不得破坏旧节目；旧 Program 已丢失且新源失败时进入 `NO PROGRAM`。

Source Preview 只按需建立。正常 Workspace 永远保留一个主 Program Monitor；预监其他 Source 时临时出现第二个 PVW，PGM 仍保持可见。默认不常驻多画面墙。

## 3. Room / Session / Run Plan

Room 是长期直播工作空间，保存常用 Sources、Rendition/Output 预设和 Run Plans。

Session 表示一次真实直播，保存实际 Program、Outputs、Recording、Runtime Evidence、Incidents 与 Timeline。计划值与实际值必须分开记录，运行历史不得被模板覆盖。

Run Plan 表示“本场准备怎么播”，组合 Source、Program 候选、Required/Optional Outputs、Recording 与 Failover 意图。Run Plan 是高层 Desired State，不是新的媒体 Runtime。

## 4. Output 与共享 Rendition

Output 统一表达业务交付，不再把 Forwarding、Transcode、CDN、Playback 分割为一等业务模块。其核心组成是：`Media + Processing + Mode + Transport/Format + Protection + Destination + Runtime Evidence`。

Mode 固定为：

- `PUSH`：我方主动发送；当前典型 Transport 为 RTMP / RTMPS / SRT；
- `SERVE`：我方提供端点供对方拉取；当前典型 Endpoint 为 RTMP / HTTP-FLV / HLS；
- `RECORD`：写入本地/挂载存储；当前典型 Format 为 TS / MP4 / Audio File。

PUSH 默认单 Destination + 单 Transport；SERVE 允许一个业务 Output 挂多个协议 Endpoint；RECORD 具有文件产物和 FINALIZING 语义。

相同媒体处理参数必须尽可能共享 Rendition：相同 codec、resolution、fps、bitrate、GOP、audio 参数只编码一次，再 fan-out 到多个 Output。用户看到“使用 720P”，不要求理解共享 FFmpeg Pipeline。

## 5. 场景模式与专业模式

默认使用任务导向的场景模式，首批场景包括：推到直播平台、推到 CDN、作为 CDN 回源、提供合作方拉流、SRT 专线、音频输出、本地录制/归档。

专业模式允许自定义积木组合，但由 Capability Matrix 约束，不允许绕过 Product/Runtime 明确不支持的组合。Destination 能力未知时可允许工程用户在风险提示下尝试。

场景模式与专业模式共享同一 Output 数据模型和 Runtime；从场景切换到专业模式时保留已生成配置。

## 6. Capability Matrix

可用能力是三层交集：`Product Capability ∩ Runtime Capability ∩ Destination Capability`。

产品层定义设计允许什么；Runtime 层定义当前主机、FFmpeg、SRS、存储和可选硬件真正支持什么；Destination 层定义目标平台/供应商接受什么。UI 只展示最终合法组合，并能够解释“为什么不可选”。

当前基础矩阵：

```text
PUSH  + RTMP / RTMPS / SRT       ✓
SERVE + RTMP / HTTP-FLV / HLS    ✓
RECORD + TS / MP4 / Audio File   ✓
```

Security/Protection 根据 Mode + Transport 动态变化；无关项隐藏。Product/Runtime 明确不支持时禁止 Override；Destination 能力 Unknown 时专业模式可在明确提示下尝试。

## 7. Evidence / Health

统一证据阶梯：`CONFIGURED → DESIRED → RUNTIME → OBSERVED → REMOTE VERIFIED`。不同对象可达到的最高层级不同。

Evidence 是事实；Health 是 `Expected vs Actual + Operational Impact` 的解释。`Desired=STOPPED && Observed=OFFLINE` 是正常；不能把 Offline 自动等同 Fault。

每条实时证据应具有来源 Provenance、采样时间和 Freshness/TTL。`UNKNOWN`、`STALE` 与 `FAILED` 必须区分。LOCAL 与 REMOTE Evidence 必须分开展示。仅有本地 FFmpeg/Socket/bitrate 不能宣称第三方平台已经正常播出；只有供应商 API、目标 SRS 或其他独立观测才能进入 REMOTE VERIFIED。

Program Health 不使用神秘评分，只聚合可解释证据：Publisher、Video、Audio、Bitrate、Preview、关键 Output。故障按影响范围传播：Program 故障影响所有下游；单 Rendition 只影响使用它的 Output；单 Output 故障不连坐其他链路。

第一阶段只做确定性监测：Publisher/track/bitrate/worker/file growth。黑场、静帧、静音、单边音频等内容质量检测作为后续增强，先保证低误报和可解释性。

## 8. Runtime State / Operation

PUSH 基础状态：`STOPPED → STARTING → WAITING_INPUT / CONNECTING → VERIFYING → RUNNING → RETRYING / STOPPING → STOPPED / FAILED`。无 Program 时是 WAITING_INPUT，不冒充失败。

SERVE 基础状态：`DISABLED → ENABLING → AVAILABLE → DEGRADED / DISABLING → DISABLED / FAILED`。零会话仍可正常 AVAILABLE；Endpoint 可独立报告 ACTIVE/session count。

RECORD 基础状态：`STOPPED → STARTING → RECORDING → STOPPING → FINALIZING → COMPLETE`，并允许 `STALLED / FAILED`。REC 必须由文件持续增长等 Observed Evidence 支撑。

所有 Start/Stop/Retry/Switch/Session Start/End/Finalize 等动作都创建可追踪 Operation：`QUEUED → RUNNING → VERIFYING → SUCCEEDED / FAILED`；动作必须幂等，过渡状态下避免互相冲突的重复操作。

## 9. Preflight / Incident / Session Lifecycle

Preflight 是机器执行的本场可用性检查，不是人工 checklist。检查范围只覆盖当前 Program 候选、启用 Outputs、所需 Renditions、Recording 与直接依赖服务，并分为 BLOCKER / WARNING / INFO。

Session 生命周期保持简洁：`PREP → READY → ON AIR → CLOSING → ENDED`；`DEGRADED` 是 Health 修饰，不是生命周期状态。Run Plan 启动采用编排式局部成功，不因一个 Output 失败自动回滚已经正常工作的其他关键链路。

Incident 必须回答四件事：发生了什么、影响什么、当前还能不能播、推荐动作是什么。Acknowledge 只表示“人已知晓”，不等于 Resolved；恢复事件必须保留 Timeline，自动恢复与人工操作必须可区分。

收播按可见顺序编排：停止主动网络输出 → 停止/Finalize 录制 → 停止 Managed Pull → 释放 Program → 验证无计划内残留任务。Session 结束后生成可复盘摘要。

## 10. Monitor / 16:9 Interaction

主设计基准为 1920×1080，空间位置固定：左侧 Sources/Program，中间 Monitor，右侧 Outputs，底部 Incidents/Events/Resource。建议比例约 22% / 43% / 35%，整页尽量不滚动，Output 区自身滚动。

正常状态只有一个大 `PROGRAM` Monitor。预监备用 Source 时临时增加第二个 `PREVIEW / NOT PROGRAM` 窗口，PGM 保持约 65–70%，PVW 约 30–35%；切换结束后回到单 PGM。默认不为每个 Output 或 Recording 常驻播放器。Program Preview 默认采用受 Manager 同源安全代理保护的 HTTP-FLV，HLS 作为 fallback；WebRTC 当前不进入 V3 第一版。Monitor 固定保留画面、L/R RMS dBFS、分辨率/FPS、视频/音频编码和码率等一线信号证据。

Output 使用高密度通道条：正常时压缩，异常时在独立 Active Incidents 区临时上浮，恢复后回到人工排序位置。Recording 仍属于 Output，但 `REC` 使用行业习惯的红色小指示，不能让整卡长期高饱和。

所有详细编辑使用 Workspace 内 Drawer，避免跳转到独立 Forwarding/Transcode/Auth 页面。状态不能只依赖颜色；使用图形 + 文本 + 颜色。动画仅服务于短暂过渡、REC 和新 Critical Incident，禁止持续闪烁与装饰性动效。

## 11. 人因验收

三秒扫描必须回答：现在是否在播、播的是什么、来源是谁、画面声音是否正常、正在输出到哪里、哪里有问题。

十秒故障测试至少覆盖：Program Source Lost 与 Single Output Failed；第一次使用系统的工程师应能在 10 秒内识别影响范围并找到正确恢复动作。

正常操作强调安全，故障恢复强调速度。Preview 与 Switch、Retry 与 Stop、普通动作与破坏性动作必须有明确空间和视觉隔离。

## 12. 明确非目标

V3 第一版不进入：多源混音、画中画、节目制作、多画面墙、时间线、节目单/排期、自动预约开播、复杂 Runbook、AI 内容判断、无限级路由编排、完整媒体资产管理。

设计冻结后不得因实现便利重新退回“技术模块驱动 UI”。任何新增能力必须证明属于现有领域模型，或重新走设计变更评审。