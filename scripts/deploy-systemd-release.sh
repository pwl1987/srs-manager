#!/usr/bin/env bash
# 在现有 systemd 生产节点执行一次可回退的 SRS Manager release 升级。
# 用法：sudo ./scripts/deploy-systemd-release.sh <release-staging-dir> [target-dir]
set -Eeuo pipefail

SOURCE_DIR="${1:-}"
TARGET_DIR="${2:-/home/ubuntu/srs-manager}"
BACKUP_ROOT="${BACKUP_ROOT:-/home/ubuntu/srs-manager-backups}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_DIR="$BACKUP_ROOT/$STAMP"
UNIT_NAME="srs-manager-record-worker.service"
UNIT_TARGET="/etc/systemd/system/$UNIT_NAME"

[[ "${EUID:-$(id -u)}" -eq 0 ]] || { echo "请使用 sudo/root 执行" >&2; exit 2; }
[[ -n "$SOURCE_DIR" ]] || { echo "缺少 release staging directory" >&2; exit 2; }
SOURCE_DIR="$(cd "$SOURCE_DIR" && pwd)"

need() { command -v "$1" >/dev/null 2>&1 || { echo "缺少依赖：$1" >&2; exit 1; }; }
for cmd in rsync curl python3 sha256sum systemctl; do need "$cmd"; done
[[ -f "$SOURCE_DIR/backend/server.js" ]] || { echo "release backend 不完整" >&2; exit 1; }
[[ -f "$SOURCE_DIR/frontend/dist/index.html" ]] || { echo "release frontend/dist 未构建" >&2; exit 1; }
[[ -f "$SOURCE_DIR/deploy/systemd/$UNIT_NAME" ]] || { echo "缺少 Record Worker unit" >&2; exit 1; }
[[ -f "$TARGET_DIR/.env" && -d "$TARGET_DIR/data" ]] || { echo "目标 .env/data 不完整" >&2; exit 1; }
[[ -d "$TARGET_DIR/backend/node_modules" ]] || { echo "目标 backend/node_modules 不存在" >&2; exit 1; }

src_lock="$(sha256sum "$SOURCE_DIR/backend/package-lock.json" | awk '{print $1}')"
dst_lock="$(sha256sum "$TARGET_DIR/backend/package-lock.json" | awk '{print $1}')"
[[ "$src_lock" == "$dst_lock" ]] || {
  echo "backend 依赖锁发生变化；拒绝在生产节点临时联网 npm install。" >&2
  echo "请先准备经过 CI 验证的依赖产物。" >&2
  exit 1
}

if [[ "${ALLOW_ACTIVE_MEDIA:-0}" != "1" ]]; then
  python3 - "$TARGET_DIR/data/srs-manager.db" <<'PY'
import json, sqlite3, sys, urllib.request
db_path = sys.argv[1]
busy = []
try:
    payload = json.load(urllib.request.urlopen(
        "http://127.0.0.1:1985/api/v1/streams?start=0&count=10000", timeout=3))
    streams = [str(item.get("name")) for item in payload.get("streams", []) if item.get("name")]
except Exception as exc:
    raise SystemExit(f"无法确认 SRS 空闲状态，拒绝部署: {exc}")
if streams:
    busy.append("SRS online streams=" + ",".join(streams[:20]))
with sqlite3.connect(db_path) as db:
    for table in ("pull_tasks", "forward_tasks", "stream_transcode_bindings", "record_tasks"):
        try:
            columns = {row[1] for row in db.execute(f"PRAGMA table_info({table})")}
            if "desired_state" not in columns:
                continue
            count = db.execute(f"SELECT COUNT(*) FROM {table} WHERE desired_state='RUNNING'").fetchone()[0]
            if count:
                busy.append(f"{table} desired RUNNING={count}")
        except sqlite3.DatabaseError as exc:
            raise SystemExit(f"无法确认 {table} 状态，拒绝部署: {exc}")
if busy:
    print("检测到活动直播/任务，默认拒绝重启控制面:", file=sys.stderr)
    for item in busy:
        print(" - " + item, file=sys.stderr)
    print("如确需带业务升级，显式设置 ALLOW_ACTIVE_MEDIA=1。", file=sys.stderr)
    raise SystemExit(42)
PY
fi

if [[ "${CHECK_ONLY:-0}" == "1" ]]; then
  echo "systemd release preflight PASS"
  exit 0
fi

mkdir -p "$BACKUP_DIR/code"
rsync -a --delete   --exclude '.git/' --exclude '.env' --exclude 'data/'   --exclude 'backend/node_modules/' --exclude 'frontend/node_modules/'   "$TARGET_DIR/" "$BACKUP_DIR/code/"
python3 - "$TARGET_DIR/data/srs-manager.db" "$BACKUP_DIR/srs-manager.db" <<'PY'
import sqlite3, sys
src, dst = sys.argv[1], sys.argv[2]
with sqlite3.connect(src) as source, sqlite3.connect(dst) as target:
    source.backup(target)
    row = target.execute("PRAGMA integrity_check").fetchone()
    if not row or row[0] != "ok":
        raise SystemExit("SQLite backup integrity_check failed")
PY

record_unit_existed=0
if [[ -f "$UNIT_TARGET" ]]; then
  record_unit_existed=1
  cp -a "$UNIT_TARGET" "$BACKUP_DIR/$UNIT_NAME"
fi

rollback() {
  local code=$?
  trap - ERR
  echo "部署失败，恢复 release 前代码：$BACKUP_DIR" >&2
  systemctl stop srs-manager-record-worker.service srs-manager-transcode-worker.service     srs-manager-push-worker.service srs-manager-pull-worker.service srs-manager.service 2>/dev/null || true
  rsync -a --delete     --exclude '.git/' --exclude '.env' --exclude 'data/'     --exclude 'backend/node_modules/' --exclude 'frontend/node_modules/'     "$BACKUP_DIR/code/" "$TARGET_DIR/"
  if [[ "$record_unit_existed" -eq 1 ]]; then
    cp -a "$BACKUP_DIR/$UNIT_NAME" "$UNIT_TARGET"
  else
    systemctl disable "$UNIT_NAME" >/dev/null 2>&1 || true
    rm -f "$UNIT_TARGET"
  fi
  systemctl daemon-reload
  systemctl restart srs-manager.service || true
  systemctl restart srs-manager-pull-worker.service srs-manager-push-worker.service     srs-manager-transcode-worker.service || true
  if [[ "$record_unit_existed" -eq 1 ]]; then
    systemctl restart "$UNIT_NAME" || true
  fi
  exit "$code"
}
trap rollback ERR

systemctl stop srs-manager-record-worker.service srs-manager-transcode-worker.service   srs-manager-push-worker.service srs-manager-pull-worker.service srs-manager.service 2>/dev/null || true

rsync -a --delete   --exclude '.git/' --exclude '.env' --exclude 'data/'   --exclude 'backend/node_modules/' --exclude 'frontend/node_modules/'   "$SOURCE_DIR/" "$TARGET_DIR/"

# systemd 直跑 backend/server.js 时，SPA 静态目录是 backend/public；
# Docker 镜像在 build 阶段完成同样复制，这里必须显式安装已验证的 frontend/dist。
rm -rf "$TARGET_DIR/backend/public"
install -d -o ubuntu -g ubuntu -m 0755 "$TARGET_DIR/backend/public"
rsync -a --delete "$SOURCE_DIR/frontend/dist/" "$TARGET_DIR/backend/public/"
chown -R ubuntu:ubuntu "$TARGET_DIR/backend/public"

install -m 0644 "$SOURCE_DIR/deploy/systemd/$UNIT_NAME" "$UNIT_TARGET"
install -d -o ubuntu -g ubuntu -m 0750 "$TARGET_DIR/data/recordings"
systemctl daemon-reload
systemctl enable "$UNIT_NAME" >/dev/null

systemctl restart srs-manager.service
healthy=0
for _ in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:3001/api/health 2>/dev/null | grep -q '"status":"ok"'; then
    healthy=1
    break
  fi
  sleep 1
done
[[ "$healthy" -eq 1 ]] || { echo "Manager 健康检查失败" >&2; false; }

systemctl restart srs-manager-pull-worker.service srs-manager-push-worker.service   srs-manager-transcode-worker.service srs-manager-record-worker.service
for unit in srs-manager.service srs-manager-pull-worker.service srs-manager-push-worker.service   srs-manager-transcode-worker.service srs-manager-record-worker.service; do
  systemctl is-active --quiet "$unit" || { echo "$unit 未进入 active" >&2; false; }
done

python3 - "$TARGET_DIR/data/srs-manager.db" <<'PY'
import sqlite3, sys
with sqlite3.connect(sys.argv[1]) as db:
    row = db.execute("PRAGMA integrity_check").fetchone()
    if not row or row[0] != "ok":
        raise SystemExit("production SQLite integrity_check failed")
PY

trap - ERR
echo "SRS Manager systemd release 部署成功"
echo "backup=$BACKUP_DIR"
