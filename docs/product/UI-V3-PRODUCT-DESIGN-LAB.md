# SRS Manager V3 Product Design Lab

> 状态：UI Authority / High-Fidelity Reference  
> 路由：`/design-lab/*`  
> 目标：在真实 Runtime 接入前冻结 V3 的产品信息架构、空间布局、状态语义和视觉语言，防止后续 Agent 自由发挥导致 UI 漂移。

## 1. Authority 规则

- V3 开发不得自行重新设计页面地图、一级导航、Workspace 空间结构或状态颜色语义；
- 产品 Domain Authority：`STREAM-WORKSPACE-V0.3-DESIGN-FREEZE.md`；
- 实施 Authority：`STREAM-WORKSPACE-V0.3-IMPLEMENTATION-PLAN.md`；
- 本文件 + `frontend/src/design-lab/` + `docs/product/ui-v3/reference/` 共同构成 UI Authority；
- Design Lab 只使用 Mock 数据，不连接或伪造 Pull / Push / Transcode / Preview Runtime；
- 开发环境可直接访问 Design Lab；生产构建仍要求认证，Design Lab 不能成为真实操作入口。

## 2. 产品 IA

```text
运行
├─ 直播间
└─ 告警中心

资源
├─ 媒体规格
└─ 开播方案

集成
├─ 平台与 CDN
├─ DNS
└─ 凭据与访问控制

系统
├─ 节点与运行环境
├─ 系统设置
└─ 版本与发布
```
## 3. Design Lab 路由

- `/design-lab/rooms` — 直播间总览；
- `/design-lab/rooms/1?state=onair` — Workspace 正常直播态；
- `/design-lab/rooms/1?state=prep` — PREP / Preflight；
- `/design-lab/rooms/1?state=preview` — PGM + 临时 PVW；
- `/design-lab/rooms/1?state=incident` — 单 Output 故障；
- `/design-lab/rooms/1?state=closing` — 收播 / Finalizing；
- `/design-lab/incidents` — 告警中心；
- `/design-lab/profiles` — 媒体规格；
- `/design-lab/run-plans` — 开播方案；
- `/design-lab/integrations` — 平台与 CDN；
- `/design-lab/integrations/wangsu` — Provider 详情 / Capability / Channels；
- `/design-lab/dns` — DNS；
- `/design-lab/credentials` — 凭据与访问控制；
- `/design-lab/rooms/1/sessions/20260917-01` — 历史 Session 只读复盘；
- `/design-lab/system` — 节点与运行环境；
- `/design-lab/states` — Loading / Empty / Error / Capability / Permission 状态样板；
- `/design-lab/settings` — 系统设置；
- `/design-lab/releases` — 版本与发布。

## 4. Workspace 固定空间结构

Workspace 采用“两条顶栏 + 三个主区 + Signal Route + Operations Dock”：

```text
Global System Strip
Session Command Bar
Input Rack | Program Control Surface | Output Rack
Signal Route Strip
Operations Dock
```

三栏主区在 1920×1080 下约为 `22% / 43% / 35%`。进入 Workspace 后侧栏收缩为窄 Rail，避免普通后台 Shell 占据播控空间。
## 5. Workspace 状态语义

- `PREP`：Session 未 ON AIR；PGM 可有真实信号但标记 `READY`，Outputs 只显示 READY / armed，不得显示 LIVE；
- `ON AIR`：默认单 PGM，大画面 + L/R dBFS + Signal Health + Media Facts；
- `PREVIEW`：PGM 保持可见，临时增加约 30–35% PVW，并明确 `NOT PROGRAM`；
- `INCIDENT`：异常 Output 进入 Active Incident 区并在 Signal Route 标记影响，其他正常链路不得被整体染红；
- `CLOSING`：网络 Outputs 逐项 STOPPED，RECORD 可进入 FINALIZING，Summary 必须反映真实剩余任务；
- Workspace 生命周期与 Health 分开：例如 `ON AIR · DEGRADED`，不能把 DEGRADED 当生命周期状态。

## 6. 信息层级

- L0 系统底座：节点、Worker、时钟；
- L1 本场直播：Room / Session / Run Plan / Program / Required Health；
- L2 实时工作面：Source、PGM/PVW、Outputs、REC；
- L3 信号关系：Source → Program → Rendition → Output；
- L4 运行过程：Incidents / Events / Operations / Resources；
- L5 配置细节：Drawer / Evidence Drill-down。

普通页面使用完整侧栏；Workspace 使用窄 Rail。Source / Output / Run Plan 的创建和编辑优先使用 Drawer，不跳离当前工作面。

## 7. 视觉与人因约束

- Broadcast Control Surface，而不是互联网 Dashboard；
- 深石墨灰 Surface，依靠边界、间距和状态精度形成层次，不依靠大面积玻璃、霓虹或发光；
- 蓝色只表示选择/控制/Ready，绿色只表示真实 Healthy evidence，琥珀表示 transition/degraded，红色表示 fault/destructive/REC；
- 状态必须同时有文字、图形和颜色；
- 正常 Output 高密度压缩，异常才扩大；
- Preview 与 Switch 必须在空间和视觉上明显区分；
- 数据刷新原位更新，禁止普通指标变化造成列表跳动；
- 1920×1080 是主验收画布，高分辨率增加可见密度而不是把卡片无限放大。
## 8. 参考截图

1920×1080 基准截图位于 `docs/product/ui-v3/reference/`：

- `rooms-overview-1920x1080.png`
- `workspace-on-air-1920x1080.png`
- `workspace-prep-1920x1080.png`
- `workspace-preview-1920x1080.png`
- `workspace-incident-1920x1080.png`
- `workspace-closing-1920x1080.png`
- `media-profiles-1920x1080.png`
- `run-plans-1920x1080.png`
- `integrations-1920x1080.png`
- `integration-wangsu-1920x1080.png`
- `session-replay-1920x1080.png`
- `state-catalog-1920x1080.png`

这些截图是视觉回归基线，不是独立设计稿。若高保真代码与截图不一致，以已审核并重新生成的最新 Design Lab 为准，同时必须更新截图，禁止两套 Authority 长期分叉。

## 9. UI Freeze Gate

进入 Phase 00 Contract 前至少满足：

1. `npm run check-i18n` 通过；
2. `npm run build` 通过；
3. 1920×1080 下直播间总览和 Workspace 五态无页面级滚动溢出；
4. PGM/PVW、PREP、INCIDENT、CLOSING 的状态语义与 Domain Authority 一致；
5. 媒体规格、开播方案、集成、凭据、节点等外部页面使用同一 Shell / status grammar；
6. Source / Output / Evidence Drawer 不要求跳转旧技术页面；
7. 3 秒扫描能识别 Program / Health / Outputs / Incident；
8. 单 Output 故障能够在 10 秒内定位影响范围与恢复入口。

UI Freeze 以后，新的视觉想法默认进入后续 backlog；实现阶段只允许因真实 Contract 缺口、可用性缺陷或安全问题修改 Authority。

**Phase UI-00：COMPLETE。** 直播间总览、Workspace 五态、媒体规格、开播方案、告警、Session 复盘、Provider 详情、DNS、凭据、节点、设置、版本与异常状态样板均已形成可运行高保真 Authority；生产 Runtime 未接入。
