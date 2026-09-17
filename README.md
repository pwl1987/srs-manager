<div align="center">

# SRS Manager · 直播运维控制台

**面向 SRS 的推流、拉流、监看、分发与直播值守控制台**

`v0.3.0 MVP` · `React 19` · `Node.js 24` · `SQLite WAL` · `FFmpeg Pull Worker`

> 当前 MVP 目标很明确：**能推进去、能拉进来、能看见真实状态、能安全控制。**

</div>

---

## 当前版本：v0.3.0 MVP

v0.3.0 已经把项目从“配置型管理后台”推进到“可实际值守的直播运维控制台”。当前最重要的两条业务链路已经形成可用闭环：

- **推流**：创建直播流 → 获取 RTMP 推流地址 → OBS/编码器推入 SRS → 工作台观察真实 Publisher 与运行状态；
- **拉流**：创建外部源 → 绑定 Managed Pull → Pull Worker 使用 FFmpeg 拉入 SRS → 支持重试、主备故障切换和人工安全切源。

完整版本记录见 [CHANGELOG.md](./CHANGELOG.md)，产品内也可直接打开「版本更新」页面查看。

## MVP 快速开始

### 1. 推流到 SRS

进入「直播流」，创建或选择一条流，复制系统生成的 RTMP 推流地址：

```text
rtmp://<SRS_HOST>:1935/live/<STREAM_NAME>
```

在 OBS、编码器或其他推流设备中填写该地址。推流开始后，SRS Manager 会通过 SRS API 与 Hooks 观察真实 Publisher、码率、观众和在线状态。

### 2. 从外部源拉流到 SRS

进入「转发路由」创建外部来源，可使用 RTMP、RTMPS、SRT、RTSP、HTTP 或 HTTPS 地址；随后进入对应的「单流工作台」绑定 Managed Pull。

执行链路：

```text
外部直播源
   ↓
Pull Worker / FFmpeg
   ↓
SRS /live/<stream>
   ↓
播放、CDN、后续分发
```

同一 PullTask 可以配置多个候选源。主源连续失败达到门槛后，Worker 会按优先级切换到备用源；人工切源采用受控 Operation，按「停止旧源 → 确认 Publisher 消失 → 启动目标源 → 验证新 Publisher」执行。

## 产品能力

| 能力域 | 当前能力 |
|---|---|
| 运营中心 | 系统状态、正在直播、码率/观众、事件时间线、MVP 推流/拉流快捷入口 |
| 直播流 | 流管理、推流地址、拉流地址、二维码、预览、真实在线状态 |
| 单流工作台 | 输入/输出聚合、Publisher/Viewer 状态、Managed Pull、CDN、转发、分发、活动记录 |
| Managed Pull | 独立 Pull Worker、FFmpeg 拉流、重试退避、Worker Lease、主备源、人工安全切源 |
| CDN | 网宿 CDN 频道管理、状态查询、启停、禁播/复播 |
| DNS | 阿里云 DNS 与域名记录管理 |
| 转发 | 外部来源、转发任务、SRS Forward 管理 |
| 鉴权 | 推流/拉流密钥、时间戳防盗链、密钥轮换 |
| 转码 | 转码模板、纯音频模板、SRS 配置生成 |
| 监看 | 单流状态、HLS 预览、观众趋势 |
| 版本更新 | 产品内版本时间线、当前版本亮点、仓库中文 CHANGELOG |

## 架构概览

```mermaid
flowchart LR
    PUSH[OBS / 编码器 / 第三方推流] --> SRS[SRS]
    SRC[外部直播源] --> WORKER[Pull Worker + FFmpeg]
    WORKER --> SRS
    SRS --> PLAYER[HLS / FLV / RTMP 播放]
    SRS --> CDN[网宿 CDN]
    SRS --> FORWARD[第三方转推]
    MANAGER[SRS Manager Web] --> SRS
    MANAGER --> WORKER
    MANAGER --> CDN
    MANAGER --> DNS[阿里云 DNS]
```

### 运行组件

- **Web**：Node.js 24 + Express，提供 API、认证、页面与运维控制；
- **前端**：React 19 + Vite + Tailwind CSS v4；
- **数据库**：SQLite WAL；
- **Pull Worker**：独立容器，持有唯一 Worker Lease，负责 Managed Pull 生命周期；
- **媒体执行**：FFmpeg，默认优先直拷贝/封装转换，不自动偷偷转码；
- **状态事实源**：SRS streams / clients / hooks 与 Worker Runtime 共同组成真实运行证据。

## 部署

### 前置条件

- Docker 与 Docker Compose；
- 已运行的 SRS；
- RTMP 端口默认 `1935`；
- SRS HTTP API 端口默认 `1985`；
- 如使用 CDN / DNS 功能，需要对应的网宿和阿里云凭据。

### 1. 准备环境变量

```bash
cp .env.example .env
```

核心配置：

```bash
SRS_API_URL=http://host.docker.internal:1985/api/v1
SRS_API_TOKEN=<SRS_API_TOKEN>
ADMIN_USER=admin
ADMIN_PASSWORD_HASH=<BCRYPT_HASH>
JWT_SECRET=<RANDOM_SECRET>
ACCESS_TOKEN_TTL=7200
REFRESH_TOKEN_TTL=604800
CORS_ALLOWED_ORIGINS=http://localhost:3001
```

生成管理员密码哈希：

```bash
node -e "require('bcryptjs').hash('your-password', 10).then(h => console.log(h))"
```

### 2. 配置 SRS Hooks

将 `srs-hooks-config.conf` 中的 Hooks / Forward 配置合并进 SRS 配置，并确保 SRS 可以访问 Manager API。

### 3. 启动

```bash
./scripts/deploy.sh
```

或：

```bash
docker compose up -d --build
```

默认访问地址：

```text
http://<服务器IP>:3001
```

### 4. 健康检查

```bash
curl http://localhost:3001/api/health
```

正常情况下返回：

```json
{"status":"ok","uptime":123}
```

## CI 使用策略

为了节省 GitHub Actions 用量，CI 从 v0.3.0 起按变更范围执行：

- **后端快速检查**：只有 `backend/**` 变化时运行；
- **前端快速检查**：只有 `frontend/**` 变化时运行；
- **容器发布检查**：普通业务代码提交不自动构建镜像，仅 Docker / Compose / 依赖清单变化、版本标签或人工触发时运行；
- 同一分支有新提交时，旧的同类 CI 自动取消，避免重复消耗；
- 纯文档与 CHANGELOG 更新不触发构建类 CI。

发布前仍建议人工触发一次「容器发布检查」，确保 Web 镜像、Pull Worker 镜像、Compose 与 FFmpeg 运行时完整通过。

## 文档导航

- [产品与工作流设计](./docs/product/README.md)
- [整改阶段状态](./docs/product/REDESIGN-STATUS.md)
- [流向与控制模型](./docs/product/STREAM-FLOW-AND-CONTROL-MODEL.md)
- [单流工作台设计](./docs/product/STREAM-WORKSPACE-V0.1.md)
- [拉流运行时与四向链路](./docs/product/PULL-RUNTIME-AND-FLOW-LINKAGE-V0.1.md)
- [主备拉流与故障切换](./docs/product/PULL-FAILOVER-V0.1.md)
- [界面与体验整改基线](./docs/product/UI-REDESIGN-V0.1.md)
- [版本更新记录](./CHANGELOG.md)

## 项目结构

```text
srs-manager/
├── frontend/                 # React 运营控制台
├── backend/                  # Express API 与业务服务
│   ├── pull-worker.js        # Managed Pull 独立 Worker
│   ├── routes/               # API 路由
│   ├── services/             # 领域服务 / Operation / 状态聚合
│   └── tests/                # 后端回归测试
├── docs/product/             # 中文产品、工作流和架构设计
├── scripts/                  # 部署与验证脚本
├── Dockerfile                # Web / Pull Worker 多阶段镜像
├── docker-compose.yml        # Web + Pull Worker 编排
├── srs-hooks-config.conf     # SRS Hooks 配置片段
└── CHANGELOG.md              # 中文版本更新记录
```

## 安全基线

- Access Token + Refresh Token + bcrypt 登录认证；
- 登录失败锁定与请求限流；
- 外部 Source URL 在普通 API 与 Worker 日志中默认脱敏；
- Pull Worker 使用 Lease 保证单执行者；
- 危险操作必须区分配置状态、期望状态、运行状态和真实观测状态；
- 人工安全切源不会直接改一个字段后宣称成功，而是经过完整 Operation 状态机验证。

## 开发

后端：

```bash
cd backend
npm ci
npm test
node server.js
```

前端：

```bash
cd frontend
npm ci
npm run build
npm run dev
```

---

> 当前优先级：先把 **推流 / 拉流 MVP** 做稳，再继续推进 OUT-PUSH / OUT-PULL、Live Event、Preflight、告警、Reconciler、Runbook 与自动化。
