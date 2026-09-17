# SRS Manager 产品与工作流设计

本目录用于沉淀 SRS Manager 从“功能型 CRUD 管理后台”向“直播运维控制台（Streaming Operations Console）”演进过程中的产品、工作流、人因工程和领域设计基线。

当前基线：

- [流向与控制模型 v0.1](./STREAM-FLOW-AND-CONTROL-MODEL.md) — 定义 IN-PUSH / IN-PULL / OUT-PUSH / OUT-PULL 四类链路、控制权、停止语义、联动、Desired/Observed State、Access Grant 与 Operation。
- [UI / UX 整改基线 v0.1](./UI-REDESIGN-V0.1.md) — 定义 P1 的专业播控台视觉方向、信息架构、Shell、设计 Token、运营中心与后续 Stream Workspace 演进顺序。

当前实施顺序：

1. P1 — UI Shell / 导航 / Design Token / 运营中心；
2. P2 — Stream Workspace；
3. P3 — Flow Graph 与四类流向联动；
4. P4 — Live Event / Template / Preflight；
5. P5 — Operation / Desired State / Reconciler / Alert；
6. P6 — Batch / Runbook / Automation。

后续讨论形成稳定结论后继续补充详细领域模型、工作流、自动化、告警与设计系统规范。
