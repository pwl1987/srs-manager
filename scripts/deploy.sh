#!/usr/bin/env bash
# SRS Manager 一键部署/升级脚本。
# 用法：ADMIN_PASSWORD='强密码' ./scripts/deploy.sh
# 若首次部署未提供 ADMIN_PASSWORD，将生成一次性随机密码并只在终端显示一次。

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$PROJECT_DIR/.env"
COMPOSE_FILE="$PROJECT_DIR/docker-compose.yml"
cd "$PROJECT_DIR"

need() {
  command -v "$1" >/dev/null 2>&1 || { echo "缺少依赖：$1" >&2; exit 1; }
}
need docker
need curl
need openssl
docker compose version >/dev/null 2>&1 || { echo "需要 Docker Compose v2（docker compose）" >&2; exit 1; }

if [ ! -f "$ENV_FILE" ]; then
  cp .env.example "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  echo "已从 .env.example 创建 .env"
fi
chmod 600 "$ENV_FILE"

read_env() {
  local key="$1" raw
  raw="$(grep -E "^${key}=" "$ENV_FILE" | tail -n1 | cut -d= -f2- || true)"
  raw="${raw#\'}"; raw="${raw%\'}"
  raw="${raw#\"}"; raw="${raw%\"}"
  printf '%s' "$raw"
}

write_env() {
  local key="$1" value="$2" tmp
  tmp="$(mktemp)"
  grep -v -E "^${key}=" "$ENV_FILE" > "$tmp" || true
  printf "%s='%s'\n" "$key" "$value" >> "$tmp"
  mv "$tmp" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
}

jwt_secret="$(read_env JWT_SECRET)"
if [ -z "$jwt_secret" ] || [ "$jwt_secret" = 'your_jwt_secret_key' ]; then
  jwt_secret="$(openssl rand -hex 64)"
  write_env JWT_SECRET "$jwt_secret"
  echo "已生成 JWT_SECRET"
fi

admin_hash="$(read_env ADMIN_PASSWORD_HASH)"
generated_password=''
if [ -z "$admin_hash" ] || [[ "$admin_hash" == *generated_bcrypt_hash* ]] || [ "$admin_hash" = 'default_change_me' ]; then
  admin_password="${ADMIN_PASSWORD:-}"
  if [ -z "$admin_password" ]; then
    admin_password="$(openssl rand -hex 16)"
    generated_password="$admin_password"
  fi

  echo "首次部署：准备生成管理员 bcrypt 哈希…"
  # 使用项目镜像内已安装的 bcryptjs，避免要求宿主机安装 Node/npm。
  export ADMIN_PASSWORD_HASH=bootstrap
  docker compose -f "$COMPOSE_FILE" build srs-manager >/dev/null
  admin_hash="$(docker compose -f "$COMPOSE_FILE" run --rm --no-deps -T \
    --entrypoint node srs-manager \
    -e "const bcrypt=require('bcryptjs');process.stdout.write(bcrypt.hashSync(process.argv[1],10))" \
    "$admin_password")"
  write_env ADMIN_PASSWORD_HASH "$admin_hash"
  unset ADMIN_PASSWORD_HASH
fi

mkdir -p "$PROJECT_DIR/data"

echo "构建并启动 Web / Pull Worker / Push Worker…"
docker compose -f "$COMPOSE_FILE" up -d --build

echo "等待健康检查…"
healthy=0
for _ in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:3001/api/health 2>/dev/null | grep -q '"status":"ok"'; then
    healthy=1
    break
  fi
  sleep 2
done

if [ "$healthy" -ne 1 ]; then
  echo "SRS Manager 未通过健康检查，最近日志：" >&2
  docker compose -f "$COMPOSE_FILE" logs --tail=200 >&2 || true
  exit 1
fi

echo
echo "SRS Manager 已启动：http://127.0.0.1:3001"
echo "请确认 SRS 已按 srs-hooks-config.conf 配置 HTTP Hooks。"
if [ -n "$generated_password" ]; then
  echo
echo "首次生成的管理员密码（仅显示本次，请立即保存并在登录后妥善管理）："
  echo "$generated_password"
fi

echo
echo "控制面冒烟测试："
echo "  ADMIN_PASSWORD='<管理员密码>' node scripts/e2e-test.js"
