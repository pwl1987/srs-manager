# Phase 06 — Session / Run Plan / Preflight Authority

状态：COMPLETE

## 冻结模型

- `Run Plan` 是直播间长期可复用的开播意图，只引用既有 Source / Output；不复制 Runtime truth。
- `Session` 表示一次真实直播，创建时冻结 Run Plan Snapshot；后续修改长期方案不得改写当前或历史 Session。
- `session_outputs` 只保存本场 Output 引用、Required/Optional、auto-start 与临时性意图。
- Source/Program/Output 的 Desired / Runtime / Observed 继续由既有 Runtime Authority 提供。

## 生命周期

`PREP → READY → ON_AIR → CLOSING → ENDED`

Phase 06 实现 PREP / READY / ON_AIR；CLOSING / ENDED 的自动编排由 Phase 07 收口。

## Preflight

- BLOCKER：阻止 Session Start；
- WARNING：允许 READY / Start，但必须保留可见警告；
- INFO：记录已验证事实；
- Required Output 缺失/依赖不可用升级为 BLOCKER；Optional 同类问题降为 WARNING。
## Start 编排

- Start 前强制重新执行 Preflight；BLOCKED 时不得修改任何 child Output Desired state。
- Session Start 使用父 Operation，并为每个 auto-start Output 使用稳定 child idempotency key。
- 浏览器/Agent 重试同一 `Idempotency-Key` 不得重复创建 Output task 或 child Operation。
- child Output 启动是局部成功模型：单路失败不得回滚已经健康的其他链路。
- 所有 child 进入终态后，Session 进入 `ON_AIR`；存在失败时父结果必须保留 `degraded=true` 和 Required/Optional 影响清单。

## Production Workspace

`SessionCommandBar` 已接真实 API：选择/快速创建 Run Plan、创建本场 Session、Preflight、READY、Start 与 ON AIR 摘要。结束直播动作暂不提前实现。

## 自动化 Gate

- Run Plan Snapshot 不受后续 Plan 编辑污染；
- Optional Runtime gap 只产生 WARNING；Required 缺失产生 BLOCKER；
- Session Start 幂等；
- Optional Output 失败不回滚健康 Required Output；
- backend regression：`64/64 PASS`；frontend i18n/build PASS。
