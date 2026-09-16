# SRS Manager - 流媒体管理面板

SRS + 网宿 CDN 直播流媒体管理面板，统一部署在 SRS 服务器上（Docker，端口 3001）。

## 技术栈

- **后端**：Node.js 24 LTS + Express + SQLite (WAL)
- **前端**：React 19 + Vite + Tailwind CSS v4
- **认证**：JWT (Access 2h + Refresh 7d) + bcrypt + 登录失败锁定
- **部署**：Docker + docker-compose

## 功能

| 模块 | 功能 |
|------|------|
| Dashboard | 在线流/带宽/观众/CDN 统计、流状态表、CDN 概览 |
| 流管理 | 流 CRUD、推流/拉流地址、一键复制 |
| CDN 频道 | 网宿直播频道 CRUD、批量启停、禁播/复播 |
| 网宿认证 | AccessKey 配置向导、凭证验证、AKSK 签名 |
| 鉴权密钥 | 推/拉流密钥、时间戳防盗链、自动轮换、Mask 显示 |
| 分发申请 | 创建/延长/撤销、操作日志、自动过期 |
| 拉流转发 | 外部拉流源、转发任务、SRS Forward 动态转发 |
| 转码模板 | 模板管理（含纯音频）、SRS 配置生成 |
| 监控 | 单流实时状态、hls.js 视频预览、ECharts 观众趋势 |
| 设置 | SRS 配置查看、NTP 时间同步检查 |

## 快速开始

### 前置条件

- Docker + docker-compose
- SRS 服务器，端口 1935 (RTMP) 和 1985 (HTTP API)
- 网宿 CDN 账号（AccessKey ID + Secret）

### 1. 配置 SRS Hooks 和 Forward

将 `srs-hooks-config.conf` 中的配置追加到 SRS 的 nginx 配置（如 `conf/nginx.conf` 的 `http` 块内）：

```nginx
http_hooks {
    enabled on;
    on_publish     http://127.0.0.1:3001/api/hooks/on_publish;
    on_unpublish   http://127.0.0.1:3001/api/hooks/on_unpublish;
    on_play        http://127.0.0.1:3001/api/hooks/on_play;
    on_stop        http://127.0.0.1:3001/api/hooks/on_stop;
    timeout        3;
}
forward {
    backend http://127.0.0.1:3001/api/forward;
    timeout 3;
}
```

重新加载 SRS：`nginx -s reload`

### 2. 准备环境变量

编辑 `.env` 文件（从 `.env.example` 复制）：

```bash
SRS_API_URL=http://host.docker.internal:1985/api/v1
SRS_API_TOKEN=<your-srs-api-token>
ADMIN_USER=admin
ADMIN_PASSWORD_HASH=<bcrypt-hash>
JWT_SECRET=<random-64-hex-chars>
ACCESS_TOKEN_TTL=7200
REFRESH_TOKEN_TTL=604800
CORS_ALLOWED_ORIGINS=http://localhost:3001
```

生成 bcrypt 密码哈希：
```bash
node -e "require('bcryptjs').hash('your-password', 10).then(h => console.log(h))"
```

### 3. 部署

```bash
./scripts/deploy.sh
```

或手动：
```bash
docker build -t srs-manager:latest .
docker compose up -d
```

### 4. 验证

```bash
curl http://localhost:3001/api/health
# 应返回 {"status":"ok","uptime":...}
```

打开浏览器访问 `http://<server-ip>:3001`，使用 admin 账号登录。

### 5. 运行 E2E 测试

```bash
node scripts/e2e-test.js
```

### 6. 验证网宿签名

```bash
node scripts/wangsu-sign-test.js <AccessKeyID> <AccessKeySecret>
```

## 项目结构

```
srs-manager/
├── Dockerfile              # 多阶段构建（前端 + 后端）
├── docker-compose.yml      # Docker Compose 配置
├── .env.example            # 环境变量示例
├── srs-hooks-config.conf   # SRS nginx 配置片段
├── scripts/
│   ├── deploy.sh           # 部署脚本
│   ├── e2e-test.js         # E2E 测试
│   └── wangsu-sign-test.js # 网宿签名验证
├── backend/
│   ├── server.js           # Express 入口
│   ├── config.js           # 配置
│   ├── database.js         # SQLite 数据库
│   ├── routes/             # API 路由
│   ├── services/           # 业务逻辑
│   ├── middleware/         # JWT 认证、Refresh Token
│   └── utils/              # 工具函数
└── frontend/
    ├── index.html          # Vite 入口
    ├── vite.config.js      # Vite 配置
    └── src/
        ├── main.jsx        # React 入口
        ├── App.jsx         # 路由
        ├── index.css       # Tailwind + 主题变量
        ├── lib/            # API 客户端、认证、工具
        ├── components/     # 布局组件
        └── pages/          # 功能页面
```

## 安全

- 网宿 AccessKey：面板 UI 配置，数据库存储
- 面板认证：JWT + Refresh Token + bcrypt + 登录失败锁定
- 密钥：SQLite 存储，API 返回 Mask
- SRS API：仅 127.0.0.1 + Bearer Token
- CORS：明确 allowedOrigins
- 限流：网宿 API 令牌桶

## 开发

```bash
# 后端
cd backend && npm install && node server.js  # 端口 3001

# 前端
cd frontend && npm install && npm run dev    # 端口 3000，代理 /api 到 3001
```
