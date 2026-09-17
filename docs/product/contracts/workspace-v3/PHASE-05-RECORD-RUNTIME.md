# Workspace V3 Phase 05 — RECORD / Storage Runtime

状态：**COMPLETE**

## 目标

把本地文件保存正式纳入 V3 `Output(mode=RECORD)`，复用既有 Program / Shared Rendition，不为录制另建第二套媒体处理模型。

## 数据与运行边界

- `record_tasks`：长期配置、Desired State、Runtime State、Worker ownership 与文件增长证据；
- `record_assets`：每一次真实录制产生的独立媒体产物；
- 数据库存储相对路径，实际根目录由 `RECORD_STORAGE_ROOT` 控制；
- Record Worker 与 Pull / Push / Transcode Worker 一样使用独占 lease + heartbeat；
- RECORD 可以消费 Program Original 或已有 Shared Rendition；
- RECORD 仍处于 `STARTING / RECORDING / STOPPING / STALLED` 时继续占用 Shared Rendition，进入 `FINALIZING` 后才释放上游。
## 文件安全策略

- MP4 不在直播过程中直接写最终文件；采集阶段统一写 TS segments；
- 正常 Stop：`STOPPING → FINALIZING → COMPLETE`，使用 FFmpeg concat/remux 生成 MP4；
- 异常退出、Worker 被杀或输入中断：已有 TS segments 标记为 `RECOVERABLE`，禁止静默删除；
- TS 录制同样先分段，正常 Stop 后合成为最终 TS；
- Audio File 只允许引用 codec 匹配的 audio-only Rendition，Record Worker 不暗中二次转码；
- 只有文件真实增长后 Runtime 才进入 `RECORDING`；进程存在但媒体不增长进入 `STALLED`。

## V3 产品接入

- `LOCAL_RECORD` 场景已进入统一 Output Builder；
- V3 API 支持 RECORD 创建、Start/Stop Operation 与幂等语义；
- Workspace Output Rack 投影 `RECORDING / FINALIZING / COMPLETE / STALLED / FAILED`；
- Workspace Evidence 使用 `Record Worker + filesystem`，并显示 Asset 状态、大小和时长；
- Capability 只有在 Record Worker heartbeat 新鲜时才宣称 RECORD Runtime available；
- Compose 已增加 `record-worker`，默认存储根为 `/app/data/recordings`。

## 验证

代码 Gate：backend `58/58 PASS`，frontend i18n/build PASS，`git diff --check` PASS。
真实文件证据见 `PHASE-05-FIELD-GATE.md`。
