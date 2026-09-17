# SRS Manager 直播业务工作台 v0.3

> 状态：Workspace V3 产品模型讨论基线，尚未进入业务代码实施。  
> 目标：把 `/streams/:id` 从“技术模块汇总页”进一步收敛为一个真正适合长期值守的直播间工作站。

## 1. 核心产品判断

Workspace V3 不再以 Pull / Transcode / Forward / Auth 等技术模块组织操作，而以值班员的真实任务组织：**信号从哪里来、当前节目是什么、要生成什么媒体版本、送到哪里、是否安全、是否真的在运行。**

统一领域模型：

```text
Room
  ↓
Input Sources *
  ↓
Source Selector
  ↓
Program（唯一）
  ↓
Renditions *
  ↓
Outputs *
```

当前版本明确保持“一选一”：一个 Room 可以登记多个 Source，但任意时刻只允许一个 Source 成为 Program；不进入混音、画中画、多画面合成、导播切换台领域。
## 2. Input Sources：输入源池

一个直播间可以登记多个输入来源，来源是长期可管理对象，不等于当前 Program。

来源统一抽象为：

```text
Source
├─ acquisition_mode: PUSH | PULL
├─ protocol
├─ endpoint / credential
├─ role: primary | standby | remote | emergency | custom
├─ priority
├─ desired / runtime / observed
└─ observed_media
```

PUSH 来源使用“稳定入口 + 独立 Ingest Credential / Stream Key”，支持复制、轮换、禁用和独立观测；不同编码器、记者手机、远程节点不共享同一个 Publisher 地址。

PULL 来源由 Worker 主动抓取，可配置主源、备用源和人工安全切换。多个来源可以同时 READY / ONLINE，但只有 Source Selector 选中的一个进入 Program。

当前版本允许：新增、禁用、删除来源；查看在线、码率、格式；设为 Program；人工切换；可选主备优先级和自动故障切换。Program 失效时必须显式进入 NO PROGRAM，不能伪报正常。
## 3. Program 与 Rendition Pool

Program 是整个直播间唯一的当前节目流。Output 不需要理解 Program 最初来自 PUSH 还是 PULL，只消费当前 Program。

Program 之后进入共享 Rendition Pool：

```text
Program
├─ Passthrough
├─ 1080P H.264/AAC
├─ 720P H.264/AAC
├─ Audio Only AAC
└─ Custom Rendition
```

Rendition 是内部可复用媒体版本，不应要求普通值班员单独管理。多个 Output 选择完全相同的处理参数时，Runtime 应复用同一个 Rendition，只编码一次，再分发到多个目标。

处理能力至少支持：原始流直通；视频+音频；仅视频；仅音频；选择全局转码模板；模板内定义 codec、分辨率、帧率、码率、GOP/keyint 等。Passthrough 不得伪装成可以改变编码参数。

## 4. Output 统一模型

Output 不再按“转码 / 转发 / CDN / 鉴权”拆成互相分离的一级模块。一个 Output 是一个完整交付对象：

```text
Output
├─ Media / Rendition
├─ Processing
├─ Mode
├─ Transport / Format
├─ Protection
├─ Destination / Consumer
└─ Runtime Evidence
```
### 4.1 Output Mode

Output Mode 当前统一为三类：

- `PUSH`：我方主动连接并发送，例如直播平台、CDN Push、SRT 目标；
- `SERVE`：我方提供端点，由第三方主动拉取，例如 RTMP / HTTP-FLV / HLS Origin；
- `RECORD`：写入存储，例如本地 TS / MP4 录制归档。

Transport / Format 由 Mode 约束，而不是一次性展示所有协议。例如 PUSH 优先出现 RTMP / RTMPS / SRT；SERVE 出现 RTMP / HTTP-FLV / HLS；RECORD 出现 TS / MP4 等文件格式。

Protection 同样由前置选择动态约束：PUSH 可使用 URL Token、Provider Auth、SRT passphrase；SERVE 可使用 Access Grant、Timestamp、Signed URL、防盗链、IP Allowlist；RECORD 不展示网络防盗链，而展示文件权限、目录与保留策略。

Destination / Consumer 表达“最终交给谁”，例如 Custom URL、网宿 CDN、直播平台、合作方、内部节点、SRT Endpoint、本地存储。

## 5. 场景模式与专业模式

底层只有一套 Output 模型，前端提供两种编辑视图：

- **场景模式（默认）**：任务驱动，系统自动拼装积木；
- **专业模式**：允许工程人员自由组合 Media / Mode / Transport / Protection / Destination，但必须经过能力矩阵约束。

场景模式不是另一套 Runtime。任何场景都可以切换到专业模式继续编辑，并保留已推导配置。
首批场景建议保持少而清晰：

1. 推到直播平台；
2. 推到 CDN；
3. 作为 CDN 回源；
4. 提供给合作方拉流；
5. SRT 专线输出；
6. 音频输出；
7. 本地录制 / 归档；
8. 专业自定义。

场景创建流程优先压缩为三步：**要送到哪里 → 使用什么媒体 → 连接与安全**。完成后展示配置摘要，并提供“保存但不启动 / 保存并启动”。默认应优先“保存但不启动”，避免创建配置即误分发。

## 6. 能力矩阵

Workspace V3 必须建立显式能力矩阵，禁止 UI 允许明显无效组合后再等 Runtime 报错。

示例：

```text
PUSH  + RTMP       ✓
PUSH  + RTMPS      ✓
PUSH  + SRT        ✓
PUSH  + HLS        ×
SERVE + RTMP       ✓
SERVE + HTTP-FLV   ✓
SERVE + HLS        ✓
RECORD + TS        ✓
RECORD + MP4       ✓
```

专业模式是“受约束的自由组合”，不是无规则配置器。前置选择改变后，后续无关选项优先隐藏而不是堆满禁用项。
## 7. 本地录制 / 归档

RECORD 是正式 Output Mode，不是边缘工具。它可以选择 Passthrough 或任意共享 Rendition，因此与网络输出共用同一套媒体处理和复用机制。

普通场景至少提供：录制媒体、文件格式、保存目录、分段策略、文件名模板、开始/停止。

可靠性原则：直播过程优先考虑可恢复性。普通模式可以把“MP4（推荐）”实现为录制期间写 TS 或其他更抗中断的中间文件，正常停止后无损 remux 为 MP4；专业模式再暴露 TS / MP4 / fragmented MP4 等格式差异。异常退出时不得因为最终封装未完成而丢失可恢复媒体。

录制 Runtime 状态建议使用 `STOPPED / STARTING / REC / FINALIZING / FAILED`。`REC` 可以使用行业习惯的红色录制语义，但不能通过闪烁制造长期视觉疲劳。

磁盘监控应优先翻译成业务结果，例如“预计剩余可录制 37 分钟”，而不仅显示磁盘使用率。

## 8. Runtime Evidence

所有 Output 继续坚持：`Configured ≠ Desired ≠ Runtime ≠ Observed`。

正常摘要可以压缩成 `LIVE / REC / STOPPED`，但展开后必须能够看到 Desired、Runtime、Transport/Process Evidence、Observed throughput / sessions、最近错误和运行时长。

只存在本地进程不等于远端业务成功。PUSH 的 `RUNNING` 只能证明本地受管进程和连接侧证据；有供应商 API、目标 SRS 或其他独立证据时才能进一步显示远端 Observed。
## 9. 16:9 工作台布局

桌面主场景采用“三域一条”，尽量让 1920×1080 一屏完成正常值守：

```text
┌───────────────────────────────────────────────────────┐
│ Room / Program / LIVE / bitrate / viewers / uptime   │
├──────────────┬──────────────────────┬─────────────────┤
│ INPUT        │ MONITOR              │ OUTPUTS         │
│ Source Rack  │ video + L/R meter    │ compact list    │
│ Program      │ media evidence       │ abnormal first  │
├──────────────┴──────────────────────┴─────────────────┤
│ ALERTS / EVENTS / RESOURCE / ADVANCED                │
└───────────────────────────────────────────────────────┘
```

空间记忆规则固定：左边永远是来源，中间永远是当前节目与监看，右边永远是输出，底边永远是异常、事件和资源。Output 区自身滚动，整页尽量不滚动。

Output 默认使用紧凑摘要行，支持 10–20 路仍能快速扫描；点击单路才渐进披露 Media、Transport、Security、证据和错误。异常输出临时上浮，恢复后回到人工排序位置。

## 10. 人因、人体工程与视觉规则

- 三秒扫描：进入页面后快速回答“有没有信号、来自哪里、画面声音是否正常、正在送到哪里、有没有异常”；
- 识别优先于记忆：直接显示 `720P · H.264 · 3Mbps · GOP 2s`，不要求用户记模板编号；
- 控制贴着证据：看到某 Output 运行的位置就能 Stop / Retry，不跨页寻找控制；
- Toggle 只表达持续状态，Button 只表达一次动作，Selector 只表达互斥选择；
- 状态必须同时依赖文本、图标、形态和颜色，不能只靠红绿；
- 绿色只代表有真实正常证据；蓝青用于选择/主动作；黄色用于 Transition / Degraded；红色只用于 Fault / Destructive / REC；灰色用于 Offline / Configured only；
- 平时安静、异常醒目：避免持续闪烁、无意义呼吸灯和大面积高饱和科技特效；
- 科技感来自精确、密度、实时反馈和一致性，而不是互联网 Dashboard 式装饰。
## 11. 工作阶段与下一轮讨论

Workspace 不应只有一种视觉重心。后续设计继续围绕四个真实工作阶段收敛：

1. **开播前 PREP**：来源、Program 候选、Output 配置、鉴权、录制计划；
2. **直播中 ON AIR**：Monitor、音频电平、Output 健康、告警优先，配置控件弱化；
3. **异常处置 INCIDENT**：故障 Source / Output 自动上浮，提供最短恢复动作和明确影响范围；
4. **收播 CLOSING**：停止输出、录制 Finalizing、停止输入、确认无遗留进程/会话。

下一轮重点不是继续增加能力，而是定义这四个阶段的视觉重心变化、操作顺序和安全边界，尤其要避免自动 UI 重排破坏值班员的空间记忆。

## 12. 当前非目标

Workspace V3 当前不进入：多源混音、画中画、多画面合成、复杂导播切换、时间线制作、无限级路由编排、复杂 Event/Runbook 平台。

当前产品边界保持：**多来源、一选一 Program；共享媒体派生；多 Output；场景化创建；专业模式自定义；真实运行证据。**

## 13. 实施前 Gate

在进入代码实施前必须先完成：

- Source / Program / Rendition / Output 的数据契约；
- Output Mode 与 Transport / Protection 的能力矩阵；
- 场景模式首批预设及默认值；
- 16:9 信息架构与交互原型；
- PREP / ON AIR / INCIDENT / CLOSING 四阶段行为；
- 现有 V2 数据如何无损迁移到 V3，禁止破坏已经验证的 Pull / Push / Transcode Runtime。
