# Workspace V3 Phase 08 — Cutover / Release Field Gate

日期：2026-09-18
目标版本：v0.6.0
主机：`live` / `10.30.5.199`

状态：**PASS / Workspace V3 COMPLETE**

## 1. 16:9 UI Cutover

生产 Workspace 已切换到 V3 主控制面：

- 顶部 Global System Strip + Session Command Bar；
- 左侧 Input Rack；
- 中央 Program Control Surface，默认单 PGM，按需 PGM + PVW；
- 右侧统一 Output Rack；
- 下方 Signal Route + Operations Dock；
- 旧 Transcode / Forward / OUT-PULL 仅保留在 Advanced Drawer；
- `/forwarding`、`/monitor` 等旧入口保留兼容深链，但不再出现在主导航。

视觉回归基线位于 `docs/product/ui-v3-reference/phase08/`：

- 1920×1080：ON AIR / PREP / PREVIEW / INCIDENT / CLOSING；
- 1366×768：compact；
- 2560×1440；
- 3840×2160。

`npm run check-phase08-layout`：**PASS（8/8）**。所有基准场景根容器均无整页滚动；1366×768 仅允许 Program 区内部滚动作为 compact 降级。

## 2. 自动回归与发布门禁

- Backend：**69/69 PASS**；
- Frontend i18n：PASS；
- Frontend production build：PASS；
- `git diff --check`：PASS；
- Compose model：PASS；
- `scripts/deploy.sh`：`bash -n` PASS；
- GitHub Container Release Gate：run **35294729038**，HEAD `b0c74af`，**SUCCESS**；
- Web image、Pull Worker image、FFmpeg、Push/Transcode/Record Worker entry 全部通过。

本地 Docker build 曾因 `auth.docker.io` 网络超时失败；GitHub Runner 的完整容器 Gate 已成功，确认该失败属于本地 registry transport，而非代码或镜像构建问题。

## 3. v0.5.1 数据升级 / 旧版本回退

对真实生产 SQLite 使用 Python `sqlite3.Connection.backup()` 创建一致性副本，未修改生产数据库。

升级前：

- `integrity_check=ok`；
- 23 张旧业务表；
- 共 175 行旧数据。

对每张旧表的旧列和按 rowid 排序的数据计算 SHA-256。使用当前 V3 `database.js` 对副本执行 additive migration 后：

- `integrity_check=ok`；
- 所有旧表、旧列、行数与内容哈希 **100% 一致**；
- 仅新增 V3 Session / Incident / Record / Ingest 等表。

随后使用线上旧版 backend 打开“已升级”的数据库副本，并在临时 3110 端口启动服务：

- `/api/health` 返回 `status=ok`；
- 旧版 backend 可读取升级后 DB；
- 服务关闭后旧数据哈希仍 100% 一致；
- `integrity_check=ok`。

结论：当前 V3 schema migration 为 additive，已取得真实**升级无损 + 旧二进制回退可读**证据。

## 4. Full Session 实机闭环

使用隔离 Candidate SQLite / Worker / Recording Root，复用真实 SRS 与 FFmpeg。未替换生产业务数据库和正式 Worker。

真实链路：

- Program：`p8_gate_program`，H.264 640×360 + AAC；
- Required PUSH：`p8_gate_out`；
- Required RECORD：本地 MP4；
- Optional SERVE：PARTNER_PULL admission；
- Session：PREP → READY → ON AIR → INCIDENT → RECOVERY → CLOSING → ENDED。

结果：

- Preflight：`READY`；
- Session Start：`SUCCEEDED`；
- Session：`ON_AIR`；
- Required PUSH：真实媒体建立；
- Required RECORD：真实进入 RECORDING；
- SERVE：真实启用 admission。

故障注入为真实杀掉 Candidate Push Worker 进程组：

- Incident：`PUSH_WORKER_UNAVAILABLE`；
- severity：`CRITICAL`（Required Output）；
- 事件链：`OPENED → ACKNOWLEDGED → RECOVERED`；
- 重启 Push Worker 后 Runtime 与真实输出自动恢复。

收播结果：

- Session Close：`SUCCEEDED`；
- Session：`ENDED`；
- PUSH：`STOPPED`；
- RECORD：`COMPLETE`；
- SERVE admission：disabled；
- MP4：1,504,838 bytes，6 个安全 TS segment；
- ffprobe：H.264 640×360 + AAC 48 kHz；
- Candidate DB：`integrity_check=ok`。

## 5. 清理与生产复核

Field Gate 结束后：

- SRS `p8_gate_*` 流：0；
- 生产 Hook 测试记录：6 → 0；
- Candidate / upgrade rehearsal 临时目录已删除；
- 生产 DB：`integrity_check=ok`；
- `srs.service`、Manager、Pull Worker、Push Worker、Transcode Worker 全部保持 `active`。

## 6. 兼容与已知边界

以下不是 Phase 08 阻断项，但继续作为明确边界：

- SRS 8080 直连 HLS 不受当前 `on_play` admission 控制；公网 HLS 必须由反向代理/CDN 提供鉴权与防盗链；
- Managed PUSH 的 RUNNING/Observed 是本地证据，不等于第三方平台 Remote Verified；
- 浏览器音频表为 RMS dBFS，不是 EBU R128 / LUFS；
- `/forwarding`、`/monitor` 等旧页面继续作为 compatibility deep link；
- 既有 `echarts < 6.1.0` moderate advisory 需独立 major-upgrade 任务处理；
- GitHub Actions 对 `actions/checkout@v4` Node 20 deprecation 和 ubuntu-latest 未来迁移的提示为基础设施告警，不影响本次 Gate。

## 7. 正式生产 systemd Cutover

2026-09-18 在生产节点执行第一轮 v0.6.0 RC systemd 正式升级：

- 升级前 SRS 在线流为 0，Pull / Push / Transcode / Record Desired RUNNING 均为 0；
- 升级脚本先以 SQLite backup API 生成一致性备份，备份目录：`/home/ubuntu/srs-manager-backups/20260918T015222Z`；
- Manager、Pull Worker、Push Worker、Transcode Worker 升级成功；新增 Record Worker unit 安装、enable 并进入 active；
- 生产 DB migration 后 `integrity_check=ok`，Record Worker heartbeat < 1s；
- 首次现场执行发现 systemd 直跑 `backend/server.js` 时 SPA 必须位于 `backend/public`，而候选脚本仅同步了 `frontend/dist`，导致 API healthy 但 `/` 返回 404；
- 现场立即将已验证 `frontend/dist` 安装到 `backend/public` 并重启 Manager，Web 恢复 HTTP 200；媒体 Runtime 与生产 DB 未受损；
- 根因已永久修复到 release deploy script：systemd cutover 显式执行 `frontend/dist → backend/public`，并保持 rollback 会恢复升级前静态文件；
- 进一步增加 active-media preflight：默认发现任何 SRS 在线流或 Managed Desired RUNNING 时拒绝重启控制面。

Active-media preflight 已在真实业务流 `22` 在线时验证：

- 默认 `CHECK_ONLY=1`：检测 `SRS online streams=22`，返回 `42`，拒绝部署；
- `CHECK_ONLY=1 ALLOW_ACTIVE_MEDIA=1`：环境预检 PASS，但不执行任何 restart；
- 因 `22` 为真实 `10.128.0.251 → /live/22` Publisher，最终固定脚本的第二次正式切换延后到安全窗口，不为 release 收口中断业务流。

固定脚本二次生产执行：**PASS**。业务流 `22` 自然结束后，固定脚本重新执行自身 active-media preflight 并通过；本次未设置 `ALLOW_ACTIVE_MEDIA=1`。部署事务备份目录为 `/home/ubuntu/srs-manager-backups/20260918T023052Z`，随后自动取得 Manager health、SPA、六服务、Record heartbeat、DB integrity 与 release parity 全部 PASS。

## 8. 当前 RC 内容一致性与 post-deploy Gate

在业务流 `22` 在线、禁止再次重启控制面的前提下，完成一次纯只读生产复核：

- 当前生产 `backend/server.js`、`record-worker.js`、`v3-output-service.js`、backend lockfile 与 release staging 内容哈希一致；
- 当前生产 `backend/public` 与当前 `frontend/dist` 内容一致，只有文件时间戳差异；
- Record Worker systemd unit 与 release staging 内容一致；
- 新增 `scripts/post-deploy-smoke.sh`，统一检查 Manager API、SPA、六服务、SQLite integrity、V3 表结构、Record Worker heartbeat 与 release payload parity；
- 真实生产执行 post-deploy smoke：**PASS**，Record Worker heartbeat 约 1–2 秒；
- release deploy script 已把 post-deploy smoke 纳入同一 rollback 事务，smoke 失败即触发现有 rollback；
- 固定脚本 `CHECK_ONLY=1` 在真实流 `22` 在线时返回 **42**，继续证明 active-media preflight 会阻断 cutover。

因此生产已取得修正后完整 deploy transaction 的最终证据：事务内 post-deploy smoke PASS；事务结束后独立复核仍为六服务 active、SRS 在线流 0、DB integrity `ok`、Manager health 200、SPA 200，Record Worker heartbeat fresh。`v0.6.0` 的生产 cutover blocker 已解除，可进入 tag / GitHub Release 发布。

## 结论

UI-00 与 Phase 00–08 全部满足冻结 Authority 和阶段 Gate。Workspace V3 可标记为 **COMPLETE**，并具备发布 **v0.6.0** 的证据基础。
