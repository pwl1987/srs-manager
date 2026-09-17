# SRS Manager 直播业务工作台 v0.2

> 状态：Workspace V2 设计基线  
> 目标：把 `/streams/:id` 从技术对象汇总页升级成“一条直播业务的完整工作站”。

## 1. 产品判断

直播流不是数据库记录，也不是一组 IN/OUT 枚举。值班员真正关心的是：信号从哪里来、SRS 当前收到什么、经过什么处理、产生哪些派生码流、送到哪里、谁在看、是否可一键中断，以及画面/声音现在是否正常。

因此所有与某一路业务流直接相关的高频操作默认留在 Stream Workspace；全局模板、供应商凭据、DNS 等低频资源配置保留系统级入口。

## 2. 信号路径

```text
采集 Acquisition
├─ 外部主动推入（IN-PUSH / OBS / Encoder / upstream）
└─ 本机主动拉取（IN-PULL / primary + standby + failover）
        ↓
SRS Core
├─ Publisher / protocol / client evidence
├─ node/vhost runtime policy
└─ 原始输入码流
        ↓
Processing / Transcode
├─ 原始流 passthrough
├─ 主流 1080P
├─ 辅流 720P
├─ 纯音频
└─ 其他模板派生
        ↓
Distribution / Output
├─ 主动外推（OUT-PUSH：平台 / CDN / 第三方）
├─ 被动拉取（OUT-PULL：HLS / FLV / RTMP）
└─ CDN / Distribution
```

访问控制、鉴权、防盗链不是独立“信号节点”，而是附着在输出入口上的 Guard。运行监看同样不是信号节点，而是横跨整条链路的 Observability Layer。

## 3. Workspace 首屏

首屏必须在 3–5 秒内回答六个问题：

1. 现在是否在播？
2. 输入来自哪里？
3. 当前码率 / 观众 / 运行时长是多少？
4. 当前挂了哪些转码输出？
5. 正在向哪些平台/端点分发？
6. 画面与声音是否正常？

布局采用“On-Air Console + Signal Path”：左侧内嵌视频预览和音频电平，右侧运行指标；下方按采集 → SRS → 转码 → 输出展示链路，异常只在相应节点突出。

## 4. 采集区

### 外部主动推入

展示真实 Publisher evidence：来源 IP、协议、SRS client id、在线时长。仅在真实 client 存在时显示“正在推入”。支持精确断 Publisher。

### 本机主动拉取

在当前流内直接完成来源创建/选择、主备顺序、启停、人工切源和 failover 状态。正常工作流不得再跳转到独立 `/forwarding` 页面。

## 5. SRS Core 区

展示当前 SRS 节点、app/vhost、Publisher、原始分辨率/编码/FPS/码率、客户端数等真实观测。

GOP / keyframe 等编码参数不伪装成 SRS 任意单流开关：如果需要改变 GOP，必须进入转码派生链路重新编码；copy/passthrough 只能观察原始 GOP，不能承诺重整。

## 6. 多转码挂载

全局 `transcode_templates` 继续负责模板定义；流与模板关系从 `streams.transcode_template_id` 单值升级为多绑定：

```text
stream_transcode_bindings
- stream_id
- template_id
- role: main | secondary | audio | custom
- output_suffix / output_name
- desired_state
- runtime_state
- priority
- worker_instance_id
```

一个流可同时挂：主流 1080P、辅流 720P、纯音频以及任意自定义输出。Workspace 负责挂载/卸载/启停和运行证据；模板编辑仍在系统级“转码模板”页。

模板的 `video_config` 后续补充 GOP/keyint 能力。`vcodec=none` 表示纯音频输出。

## 7. 输出与访问控制

OUT-PUSH、CDN 和 OUT-PULL 在同一“输出分发”区域展示。每个主动输出目标必须显示目标、Desired、Runtime、最近错误，并可在当前工作台一键 Stop / Retry。

OUT-PULL 将 endpoint enabled、accept new sessions、require grant、grant revoke 与“断开当前会话”保持独立语义；防盗链/鉴权属于该输出的 Guard，不与信号状态混为一谈。

## 8. 实时监看

Workspace 默认前台 2 秒刷新运行快照；页面隐藏时降低频率，避免无意义请求。运行时长在浏览器本地按秒递增，不依赖每秒请求服务端。

监看包括：视频预览、观众数、输入码率、分发/输出数量、视频/音频编码、FPS、运行时长。音频电平优先使用浏览器 Web Audio 对当前预览做双声道电平显示，并明确标注为“本地预览电平”，不冒充 EBU R128 广播响度计。

现场 SRS 6 已验证：直连 8080 HLS 不经过现有 `on_play` 准入链路，因此 OUT-PULL Hook 策略不得宣称覆盖 HLS。管理员预览使用 Manager 3001 同源受保护代理：短时 Token 绑定单流，Manager 服务端读取 Origin HLS 并重写 playlist/segment；若向第三方开放 HLS，必须在反向代理/CDN 层另做鉴权和防盗链。

## 9. 人因与视觉基线

- 画布从近黑提升为中性深灰，避免长时间值守时黑白极端对比；
- 主文字从“近白”降低到柔和浅灰，但正文仍保持可读对比；
- 绿色只表示已观测正常，蓝色只表示选择/主动作，橙色表示注意，红色只表示故障/破坏性操作；
- 普通卡片减少硬边框和强阴影，用灰阶 Surface、留白和分组建立层级；
- 技术枚举（IN-PUSH 等）作为辅助标签，中文业务动作作为主标题；
- 破坏性动作远离高频主操作，并明确影响范围；
- 运行态变化尽量局部更新，不让整个页面闪烁/跳动。

## 10. 导航收敛

正常工作流中移除独立“实时监看”和“转发路由”导航入口：它们进入 `/streams/:id`。旧路由暂保留用于兼容和深链接，不立即删除。

“转码模板”保留为系统级可复用资源；具体挂载必须在 Stream Workspace 完成。

## 11. 实施顺序

### W2-A：视觉与 IA

灰阶主题、导航收敛、五段业务区、On-Air Console 骨架。复用现有 API，不新增假能力。

### W2-B：多转码

引入多绑定表与 Transcode Worker；支持 1080 / 720 / audio-only 等多个派生流，Desired / Runtime / Observed 分离。

### W2-C：实时监看

2 秒运行态刷新、内嵌 HLS 预览、本地音频电平、输出实时状态和一键中断。

### W2-D：收口

真实 SRS 媒体验收、移动/1440P/4K 可用性检查、删除过期入口和文案、发布版本。

## 12. 实施进度

- W2-A 已完成：灰阶播控视觉、导航收敛、直播运行台、业务信号路径、工作台内 IN-PULL/OUT-PUSH 控制。
- W2-B 已完成：`stream_transcode_bindings`、独立 Transcode Worker、同源多输出单 Pipeline、1080P/720P/纯音频、GOP/keyint 参数、Desired/Runtime/Observed。
- 2026-09-17 已在 `10.30.5.199` 使用真实 1080P 源流完成三路并发派生、ffprobe、Worker 重启恢复和单挂载 Stop 验证。
- W2-C 已完成：Manager 同源受保护 HLS 代理、短时单流 Preview Token、主/二级 playlist 与 TS 重写、本地双声道 RMS dBFS 电平；现场 `ffprobe` 已通过代理读取 H.264/AAC。
- W2-D 已完成：移动/桌面断点结构审计、四向真实媒体闭环、过期入口/文案清理与 v0.5.0 发布收口；项目进入稳定维护。
