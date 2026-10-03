# PHASE-09 冻结候选 — Core Risk Review Packet（FIX-06 后）

> 生成于 2026-09-21，PHASE-09-FIX-06（SERVE persistent generation / delete-recreate tombstone correction）全部 Final Gate 重跑通过之后。
> 面向 🔴 核心级评审（2 LGTM，其一 Code Owner）。本文件是评审导航，不是新契约；契约正文以 `PHASE-09-MAIN-ENTRY-AND-WIZARD.md`（v4 FINAL + FIX-01…FIX-06）与 `contract.json` 为准。

## 0. 冻结口径（评审前提）

- `HEAD = origin/main = 987efeb5e7b820faf1bacd4153d13f2ec0d4750d`，未漂移；无本地提交、无 push。
- 全部 PHASE-09 改动（含 FIX-01…FIX-06 六次复核修订与本 Review Packet）为 main 工作区**未提交候选**：78 文件（41 新增 + 37 修改），相对 `987efeb` 工作区等价 diff `+9051 / −453`。FIX-01…FIX-06 是候选内修订过程，**不存在中间提交 SHA**。
- 覆盖率基准 `987efeb`（独立 worktree 实测复跑：backend 81/81、frontend 15/15 全绿）。
- 冻结历史如实：FIX-04 后两次冻结结论（lifecycle correction 后、FIX-05 后）分别被独立复核推翻（三处幂等语义缺口 → SERVE ABA 缺口 → SERVE delete/recreate 复活缺口）；本 Packet 声明的冻结以 §1 全量重跑为前提，若评审再发现真实 correctness/security 问题，仍按「最小修复 + 新增回归 + 全 Gate 重跑」处理。

## 1. Final Gate 证据（2026-09-21，FIX-06 后全量重跑，无任何上一轮结果复用）

| 门禁 | 结果 | 复跑命令（backend/ = `cd backend`，frontend/ = `cd frontend`） |
| --- | --- | --- |
| 后端全量（含覆盖率） | **145/145**，exit 0 | backend/ `npm run test:coverage` |
| 前端全量 | **141/141**（16 文件），exit 0 | frontend/ `npm test` |
| intent freeze | **32/32**，exit 0 | frontend/ `npx vitest run src/lib/create-room-journal.test.js` |
| check-i18n | 957 静态键 / 84 前缀 / 94 文件，exit 0 | frontend/ `npm run check-i18n` |
| production build | 10.94s，exit 0 | frontend/ `npm run build` |
| phase08 layout | 8/8 PASS，exit 0 | frontend/ `npm run check-phase08-layout` |
| npm audit ×2 | 双侧 0 漏洞，exit 0 | `npm audit --audit-level=high`（backend/ 与 frontend/ 各一） |
| 指名批次（contract + 矩阵 18 + 幂等集成 21 含 FIX-05 ABA×4 + FIX-06 F1–F4 + 双进程 race 2 + 全部 migration 4 含真 pre-upgrade 夹具） | **62/62**，exit 0 | backend/ `node --test tests/workspace-v3-contract.test.js tests/stream-meta.test.js tests/integration/stream-meta-room-summary.integration.test.js tests/integration/wizard-creation.integration.test.js tests/integration/wizard-lost-response-matrix.integration.test.js tests/integration/output-idempotency.integration.test.js tests/integration/output-idempotency-race.integration.test.js tests/output-idempotency-migration.test.js tests/external-source-idempotency-migration.test.js tests/v3-operation-migration.test.js tests/stream-meta-migration.test.js` |
| git diff --check | 干净（含 FIX-06 文档回填后复跑） | `git diff --check` |
| Diff Coverage（≥85%） | **86.18%**（1409/1635；backend 96.11% · frontend 80.16%）PASS | 沿用 FIX-05 起声明的可复现口径（未切换算法），见 §5 |
| 全量覆盖率（降幅 ≤0.5pp） | backend 语句 **66.82%（7563/11317）vs 基线 56.28%（6053/10755）= +10.54pp**；frontend 行 **34.89%（1014/2906）vs 16.97%（392/2309）= +17.92pp** | §5 复跑命令 |
| Mimosa scan / audit / deep | 三项 exit 0，**direct 0 高危/中危/低危**（77 跨文件污点为 advisory；deep 另有 134 可达链路 / 89 业务逻辑候选，均 `verdictEffect:none`） | `node <mimosa-cli> scan . --min high --fail-on high`；`audit .`；`audit . --deep`（处置与时间线见 `docs/security/MIMOSA-GATE-UNBLOCK.md`） |

## 2. 风险面 A — Schema（🔴 本包含 streams Schema 变更，评审触发点）

| 变更 | 风险 | 锁定证据（可逐项核验） |
| --- | --- | --- |
| `serve_policy_revisions` 新表（stream_id PK，epoch + generation）（FIX-06） | 版本权威随 policy 行删除而重置 → tombstone key 复活 | `output-idempotency.integration.test.js` F1–F4；migration 测试「a true pre-FIX-05 upgrade gains the persistent SERVE revision authority」（真 pre-upgrade 夹具） |
| `out_pull_policies.generation` / `epoch`（NOT NULL DEFAULT 1）（FIX-05/06） | 迁移正确性、存量行取值 | migration 测试：真 ALTER 断言（列存在、NOT NULL、存量行 epoch=1/generation=1） |
| `output_idempotency.result_revision` / `result_epoch`（FIX-05/06） | 旧 mapping 无证据时的行为 | migration 测试：pre-upgrade mapping 双 NULL；行为补充测试：两种 NULL 形状（全 NULL / 仅 epoch NULL）均 fail-closed |
| `output_idempotency` 表 + `(room_id, idempotency_key)` 唯一索引（FIX-04） | 并发同键重复映射 | migration 测试「key constraint binds per room」；`backend/database.js` DDL 与 `ensureColumn` 迁移 |
| `streams.remark` / `streams.business_unit` / `external_sources.idempotency_key` 部分唯一索引 | legacy 库升级 | `stream-meta-migration.test.js`、`external-source-idempotency-migration.test.js`、`v3-operation-migration.test.js`（指名批次内全绿） |
| 迁移实现形态 | 无动态 SQL | 迁移路径全部为字面量 SQL + `ensureColumn`（PRAGMA 探测后 ALTER）；migration 夹具头注明「prepared statements only — no dynamic SQL」 |
| **迁移证据真实性（FIX-06 修正点）** | 「迁移后插入 + 手工置 NULL」冒充升级证据 | migration 测试重写为**真 pre-upgrade 数据库**：require `database.js` 之前建立 pre-FIX-05 `out_pull_policies` 与 FIX-04-era `output_idempotency` 并插入真实存量行，加载迁移后断言真实 ALTER 结果；手工置 NULL 手法仅保留为 NULL 路径行为补充并明确标注非结构性证据 |

## 3. 风险面 B — API 契约

- `POST /v3/rooms/:roomId/outputs`（`backend/routes/v3.js`）冻结错误词汇：422 `V3_OUTPUT_MODE_UNSUPPORTED` / 422 `V3_OUTPUT_CREATE_INVALID` / 409 `V3_OUTPUT_IDEMPOTENCY_CONFLICT` / 409 `V3_OUTPUT_IDEMPOTENCY_RESULT_GONE` / 409 `V3_OUTPUT_IDEMPOTENCY_RESULT_SUPERSEDED`；201 首创、200 + `idempotent_replay:true` 纯读重放。证据：`output-idempotency.integration.test.js` 21 条全断言 status+code。
- SERVE start/stop（`/outputs/output:serve:{id}/start|stop`）与 PUSH/RECORD start/stop 走 operation 幂等（`operations` 部分唯一索引）；serve start/stop 内部经 `setServeDesiredState → updatePolicy` 取得新 revision。证据：`v3-operation-migration.test.js` + 集成内 serve stop/start 调用 + FIX-05 stop→start 回归。
- `POST/PUT /api/streams` 部分更新语义与 `GET /v3/rooms` room_summary 形状：`stream-meta.test.js` + `stream-meta-room-summary.integration.test.js` + `workspace-v3-contract.test.js`（契约冻结 + additive-only）。
- `updatePolicy` 返回的 policy 对象与 API 响应形状未新增 epoch/generation 字段（版本机制为服务端内部权威，未泄漏进冻结 API 面）；幂等错误码未进入 `contract.json`（该文件不含幂等词汇）——如评审认为应入契约，属于评审意见而非缺口。

## 4. 风险面 C — Idempotency（本包核心正确性）

冻结状态机（`backend/services/v3-output-service.js` 头注释 = 代码内权威文本）：

- `NEW → CREATED`：「是否首次」判定 + 资源创建 + mapping INSERT 同一 `BEGIN IMMEDIATE` 事务（`db.transaction(fn).immediate()`；`updatePolicy` 内的 revision 分配嵌套其中时为 savepoint）。
- `CREATED + same fingerprint → REPLAY`：纯读零写（SERVE 以 sentinel `updated_at` + 全行逐字节断言锁定，含 epoch/generation 不动）。
- `CREATED + different fingerprint → CONFLICT`：409，原资源不变。
- `subject 删除 → RESULT_GONE`：tombstone 不改绑，新键才可重建（PUSH/RECORD/SERVE 三态各有用例）。
- `SERVE superseded → RESULT_SUPERSEDED`（同实例内）：房间持久 `(epoch, generation)` 双权威（`serve_policy_revisions`，**删除 policy 行不重置**）；epoch 不变而 generation 前进 → SUPERSEDED。
- `SERVE instance 替换 → RESULT_GONE`（FIX-06）：policy 删除后由新 key 重建 = 新 epoch 新实例，旧 key 即使字段完全相同也保持 tombstone 终局；`(epoch, generation)` 对在房间历史内永不复用。
- 并发：双进程真实竞争（`execFile` 独立 node + 共享 SQLite 文件）→ 资源 1 / mapping 1 / 同一 canonical output id。
- **对抗性核验清单**（reviewer 可直接跑指名批次逐条对号）：
  - **delete/recreate tombstone（FIX-06 F1–F4）**：`F1` 同配置删建——key-A 永久 409 GONE（非 200）、key-B 正常 201、key-A mapping 四字段不改绑、复活尝试零写（sentinel+逐字节）、key-B replay 200；`F2` 异配置删建——key-A 终局 GONE 绝不采纳 B；`F3` 最新键纯读 200 零写且 `(epoch,generation)` 与其 mapping 一致；`F4` 两轮删建——epoch/generation 严格递增（1,2,3）不回绕、authority 跨删除存活、key-A/key-B 均 GONE、key-C replay 200。
  - **ABA（FIX-05 A/B/C/D）**：`key-A:A→key-B:B→key-C:A→replay key-A` → SUPERSEDED 零写；stop→start 循环同判；立即重放全行逐字节不变（含 generation）；ABA 后仅最新键（key-C）replay 200、key-B 409。
  - **tombstone 不改绑**：`create → delete subject → replay` PUSH/RECORD/SERVE 三条（subject_id/output_id/result_revision/result_epoch 均不变）。
  - **并发**：race 2 条（双进程，同 room+key+payload）。
  - **丢响应恢复矩阵**：18 行（PUSH/RECORD/SERVE 纯读重放 + abandon 全新键行 + 负向 A–D）。
  - **intent freeze**：32 条 + abandon 零键继承断言（frontend）。
  - **legacy fail-closed**：migration 行为补充——全 NULL 与仅 epoch NULL（FIX-05-era 形状）两种旧 mapping 均 fail-closed。

## 5. 覆盖率口径说明（如实）

- Diff Coverage 固定为可复现口径（FIX-05 起声明，FIX-06 未切换算法）：`git add -N . && git diff 987efeb -U0` 新增行 ∩ coverage-final.json 语句区间（`[start.line, end.line]`），语句执行才算覆盖；测试文件按 c8/vitest 配置不在 instrumentation 内（各自 `--exclude tests/**` / `exclude *.test.*`）。当前值 **86.18% ≥85% PASS**。历史数字 88.92%/95.60% 出自已删除的临时脚本，仅存档、不作比较基线。
- 全量对比复跑命令：基线经 `git worktree add /tmp/wt-987efeb 987efeb` + node_modules 符号链接后 `npm run test:coverage`（backend）/ `npx vitest run --coverage`（frontend）；评测后 worktree 已删除。

## 6. 风险面 D — Security

- ffmpeg/ffprobe fail-closed：`backend/utils/media-bin.js` allowlist 之外一律 null；worker 终态 FAILED；污染 PATH 伪造二进制不执行。证据：`media-bin-literal.test.js`（含漂移锁定）+ `worker-fail-closed.smoke.test.js`（真实子进程终态）。
- 凭据不落库/不回流：幂等证据仅 SHA-256 指纹 + 主体引用（测试断言行内无 target_url/凭据明文）；一次性凭据明文仅创建响应，reducer RESET 后不可再现，不落 storage；external-sources 投影剥离 `idempotency_key` 与原始拉流地址。
- e2e 客户端反向 SSRF 控制（仅 http(s) + 环回/RFC1918，`scripts/e2e-target.json`）；部署脚本不再复制管理员密码到第二变量。
- Mimosa：scan/audit/deep 三项 direct 0（时间线 12→4→0→0→0；development-process deviation 如实记录于 `docs/security/MIMOSA-GATE-UNBLOCK.md`）。GitHub Static Analysis（npm audit + CodeQL）合法 push 后运行。

## 7. 风险面 E — Runtime

- 五 worker + 预监对缺失/不可信媒体二进制的终态收敛（FAIL-CLOSED，不悬挂）。
- 向导 lock/abandon 生命周期：首次提交锁定表单与步骤；放弃 = 新 journal + 全新幂等键（零继承断言）+ 明示「已创建资源不自动删除」。
- workspace 轮询器（`room-workspace-poll.js`）：停止后丢弃迟到的 stale 响应、隐藏页降频。
- SERVE revision 分配的运行时路径：独立调用（V2 policy 路由、serve start/stop）持 `BEGIN IMMEDIATE` 写锁；嵌套于 SERVE configure 事务时为 savepoint——无跨写入交错窗口（F4 + race 覆盖）。
- UI 回归：phase08 layout 8/8、四视口无横向溢出（FIX-02 playwright 验收继续有效）、i18n 957 键双侧齐全、production build 成功。

## 8. 流程披露（评审须知）

1. **Development-process deviation（已纠正）**：FIX-04 期间一次 Python 追加测试文件绕过写入扫描，随后以 Edit 重放并重新过扫描；最终候选已重新经过完整门禁。记录于 `docs/security/MIMOSA-GATE-UNBLOCK.md`，不作「本轮从未绕过任何扫描」表述。
2. **会话内 git-commit L3 hook**：最小复现显示基线树内容同样被拦（57/77 计数且非校准），定性为 ZCode 会话工具限制，非项目 Gate failure；本轮**未发生任何提交动作**（不 commit / 不 push / 不发版 / 不降低风险等级 / 不绕 Pipeline / 不新建分支 / 不 force push / 不 rewrite history）。
3. 本轮全部写入经 Edit/Write 工具完成；mimosa 插件在本会话 host 配置中处于禁用状态，安全门禁以 CLI 直跑为准（§1）。
4. 三次冻结结论均被独立复核推翻（FIX-04 后两次、FIX-05 后一次）；本 Packet 的冻结声明同样以「评审可再推翻」为前提——若发现新的真实 correctness/security 问题，按「最小修复 + 新增回归 + 全 Gate 重跑」处理，不为维持冻结结论压掉问题。

## 9. 工作区卫生

- `backend/coverage/`、`frontend/coverage/`、`frontend/dist/`、`.mimosa/`、`.zcode/` 均被 .gitignore 覆盖（`git check-ignore` 验证），不进入候选。
- 仓库内无测试数据库 / 临时探针 / 日志残留（`find` 核查；`scripts/probe-srs-origin-exposure.sh` 为基线 `70f83b9` 既有受控脚本）。
- 基线 worktree 与 diff-coverage 临时脚本已在评测后删除；`git add -N` 的 intent-to-add 标记已重置。

## 10. 外部边界（本候选之外的剩余条件）

1. 🔴 **2 LGTM，其一 Code Owner**（streams Schema 变更属核心级）——本 Packet 即为该评审准备。
2. 合法提交后 GitHub Required Checks（CI 全绿）。
3. CI 全绿后进入 199 发布（`scripts/deploy-systemd-release.sh` immutable release）；发布时执行真实节目源 HTTP-FLV 浏览器 smoke（flv 信号③；无信号不得判代码回归，信号④）。
