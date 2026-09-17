# SRS Manager 产品与工作流设计

本目录用于沉淀 SRS Manager 从“功能型 CRUD 管理后台”向“直播运维控制台（Streaming Operations Console）”演进过程中的产品、工作流、人因工程和领域设计基线。

当前基线：

- [流向与控制模型 v0.1](./STREAM-FLOW-AND-CONTROL-MODEL.md) — 定义 IN-PUSH / IN-PULL / OUT-PUSH / OUT-PULL 四类链路、控制权、停止语义、联动、Desired/Observed State、Access Grant 与 Operation。
- [UI / UX 整改基线 v0.1](./UI-REDESIGN-V0.1.md) — 定义 P1 的专业播控台视觉方向、信息架构、Shell、设计 Token 与运营中心。
- [Stream Workspace v0.1](./STREAM-WORKSPACE-V0.1.md) — 定义 P2 单流工作台、Observed / Configured / Unavailable 三类证据、精确连接控制、Workspace 聚合 API 与人因约束。

当前实施顺序：

1. P1 — UI Shell / 导航 / Design Token / 运营中心：已完成第一轮；
2. P2 — Stream Workspace / 单流信号关系 / 精确连接控制：当前实施；
3. P3 — 真正的 IN-PULL Runtime、可执行 Flow Graph 与四类流向联动；
4. P4 — Live Event / Template / Preflight；
5. P5 — Operation / Desired State / Reconciler / Alert；
6. P6 — Batch / Runbook / Automation。

后续设计继续坚持：运行态必须有真实证据来源；配置态不能冒充健康态；危险动作必须明确影响范围；没有 Runtime 支撑的能力不能在 UI 中伪造成“已运行”。
