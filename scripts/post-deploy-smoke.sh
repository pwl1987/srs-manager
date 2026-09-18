#!/usr/bin/env bash
# v0.6+ systemd 生产节点只读 post-deploy Gate。
# 用法：./scripts/post-deploy-smoke.sh [target-dir] [release-staging-dir]
set -Eeuo pipefail

TARGET_DIR="${1:-/home/ubuntu/srs-manager}"
SOURCE_DIR="${2:-}"
DB_PATH="$TARGET_DIR/data/srs-manager.db"
BASE_URL="${SRS_MANAGER_BASE_URL:-http://127.0.0.1:3001}"

need() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "缺少依赖：$1" >&2
    exit 1
  }
}
for cmd in curl python3 systemctl sha256sum; do need "$cmd"; done

[[ -f "$DB_PATH" ]] || { echo "生产数据库不存在：$DB_PATH" >&2; exit 1; }
[[ -f "$TARGET_DIR/backend/server.js" ]] || { echo "backend/server.js 不存在" >&2; exit 1; }
[[ -f "$TARGET_DIR/backend/public/index.html" ]] || { echo "生产 SPA 未安装到 backend/public" >&2; exit 1; }

health="$(curl -fsS "$BASE_URL/api/health")"
[[ "$health" == *'"status":"ok"'* ]] || { echo "Manager health 非 ok：$health" >&2; exit 1; }
curl -fsS "$BASE_URL/" | grep -qi '<div id="root"' || {
  echo "SPA root 未返回 Vite/React 入口" >&2
  exit 1
}

units=(
  srs.service
  srs-manager.service
  srs-manager-pull-worker.service
  srs-manager-push-worker.service
  srs-manager-transcode-worker.service
  srs-manager-record-worker.service
)
for unit in "${units[@]}"; do
  systemctl is-active --quiet "$unit" || {
    echo "$unit 未进入 active" >&2
    exit 1
  }
done

python3 - "$DB_PATH" <<'PY'
import datetime as dt
import json
import sqlite3
import sys
import time

db_path = sys.argv[1]
required_tables = {
    "streams", "pull_tasks", "forward_tasks",
    "stream_transcode_bindings", "record_tasks", "record_assets",
    "operations", "sessions", "incidents",
}
with sqlite3.connect(db_path) as db:
    result = db.execute("PRAGMA integrity_check").fetchone()
    if not result or result[0] != "ok":
        raise SystemExit("production SQLite integrity_check failed")

    tables = {row[0] for row in db.execute(
        "SELECT name FROM sqlite_master WHERE type='table'"
    )}
    missing = sorted(required_tables - tables)
    if missing:
        raise SystemExit("missing V3 tables: " + ",".join(missing))

    age_ms = None
    for _ in range(30):
        row = db.execute(
            "SELECT value FROM settings WHERE key='runtime.record_worker.heartbeat'"
        ).fetchone()
        if row:
            heartbeat = json.loads(row[0])
            stamp = dt.datetime.fromisoformat(
                str(heartbeat["ts"]).replace("Z", "+00:00")
            )
            now = dt.datetime.now(dt.timezone.utc)
            age_ms = max(0, int((now - stamp).total_seconds() * 1000))
            if age_ms <= 15000:
                break
        time.sleep(1)
    if age_ms is None:
        raise SystemExit("Record Worker heartbeat missing")
    if age_ms > 15000:
        raise SystemExit(f"Record Worker heartbeat stale: {age_ms}ms")
    print(f"db=ok record_worker_age_ms={age_ms}")
PY

systemctl is-enabled --quiet srs-manager-record-worker.service || {
  echo "Record Worker unit 未 enable" >&2
  exit 1
}

if [[ -n "$SOURCE_DIR" ]]; then
  SOURCE_DIR="$(cd "$SOURCE_DIR" && pwd)"
  [[ -f "$SOURCE_DIR/frontend/dist/index.html" ]] || {
    echo "release staging 缺少 frontend/dist" >&2
    exit 1
  }
  python3 - "$SOURCE_DIR" "$TARGET_DIR" <<'PY'
import hashlib
import pathlib
import sys

source = pathlib.Path(sys.argv[1])
target = pathlib.Path(sys.argv[2])
pairs = [
    ("backend/server.js", "backend/server.js"),
    ("backend/record-worker.js", "backend/record-worker.js"),
    ("backend/services/v3-output-service.js", "backend/services/v3-output-service.js"),
    ("backend/package-lock.json", "backend/package-lock.json"),
]
def digest(path):
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()
for left, right in pairs:
    if digest(source / left) != digest(target / right):
        raise SystemExit(f"release parity mismatch: {left}")

def tree_digest(root):
    h = hashlib.sha256()
    files = sorted(p for p in root.rglob("*") if p.is_file())
    for path in files:
        rel = path.relative_to(root).as_posix().encode()
        h.update(rel + b"\0")
        h.update(bytes.fromhex(digest(path)))
    return h.hexdigest()

if tree_digest(source / "frontend/dist") != tree_digest(target / "backend/public"):
    raise SystemExit("release parity mismatch: frontend/dist -> backend/public")
print("release_parity=ok")
PY

  unit_src="$SOURCE_DIR/deploy/systemd/srs-manager-record-worker.service"
  unit_dst="/etc/systemd/system/srs-manager-record-worker.service"
  [[ -f "$unit_src" && -f "$unit_dst" ]] || {
    echo "Record Worker unit parity 输入缺失" >&2
    exit 1
  }
  [[ "$(sha256sum "$unit_src" | awk '{print $1}')" == "$(sha256sum "$unit_dst" | awk '{print $1}')" ]] || {
    echo "Record Worker systemd unit 与 release staging 不一致" >&2
    exit 1
  }
fi

echo "post-deploy smoke PASS"
echo "manager=$BASE_URL"
echo "services=6/6 active"
