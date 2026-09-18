#!/usr/bin/env bash
set -Eeuo pipefail

SRS_UNIT="${SRS_UNIT:-srs.service}"
SRS_DIR="${SRS_DIR:-/usr/local/srs}"
SRS_CONF="${SRS_CONF:-$SRS_DIR/conf/srs.conf}"
TARGET_DIR="${TARGET_DIR:-/home/ubuntu/srs-manager}"
MANAGER_ENV="${MANAGER_ENV:-$TARGET_DIR/.env}"
BACKUP_ROOT="${BACKUP_ROOT:-/home/ubuntu/srs-manager-backups}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_DIR="$BACKUP_ROOT/origin-hardening-$STAMP"
ROLLBACK_ARMED=0
ROLLBACK_COMPLETE=0
MANAGER_UNITS=(
  srs-manager.service
  srs-manager-pull-worker.service
  srs-manager-push-worker.service
  srs-manager-transcode-worker.service
  srs-manager-record-worker.service
)

fail() { echo "ERROR: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || fail "missing dependency: $1"; }

[[ "${EUID:-$(id -u)}" -eq 0 ]] || fail "run as root"
for cmd in curl python3 systemctl install ss; do need "$cmd"; done
[[ -f "$SRS_CONF" ]] || fail "SRS config not found: $SRS_CONF"
[[ -f "$MANAGER_ENV" ]] || fail "Manager env not found: $MANAGER_ENV"
[[ -f "$TARGET_DIR/backend/config.js" ]] || fail "Manager code not found"
grep -q 'srsApiUsername' "$TARGET_DIR/backend/config.js" || fail "Manager code lacks SRS Basic auth support"
systemctl is-active --quiet "$SRS_UNIT" || fail "$SRS_UNIT is not active"
for unit in "${MANAGER_UNITS[@]}"; do
  systemctl is-active --quiet "$unit" || fail "$unit is not active"
done

env_value() {
  python3 - "$MANAGER_ENV" "$1" <<'PY'
import pathlib, sys
path, wanted = pathlib.Path(sys.argv[1]), sys.argv[2]
for raw in path.read_text().splitlines():
    line = raw.strip()
    if not line or line.startswith('#') or '=' not in line:
        continue
    key, value = line.split('=', 1)
    if key.strip() != wanted:
        continue
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":
        value = value[1:-1]
    print(value)
    break
PY
}

api_token="$(env_value SRS_API_TOKEN)"
api_user="$(env_value SRS_API_USERNAME)"
api_pass="$(env_value SRS_API_PASSWORD)"
api_curl() {
  if [[ -n "$api_token" ]]; then
    curl -fsS --max-time 3 -H "Authorization: Bearer $api_token" "$@"
  elif [[ -n "$api_user" && -n "$api_pass" ]]; then
    curl -fsS --max-time 3 -u "$api_user:$api_pass" "$@"
  else
    curl -fsS --max-time 3 "$@"
  fi
}
version_json="$(api_curl http://127.0.0.1:1985/api/v1/versions)"
python3 - "$version_json" <<'PY'
import json, sys
payload = json.loads(sys.argv[1])
data = payload.get('data') or {}
version = tuple(int(data.get(k) or 0) for k in ('major', 'minor', 'revision'))
if version < (6, 0, 40):
    raise SystemExit(f"SRS {version} is too old for HTTP API authentication")
print("srs_version=" + ".".join(map(str, version)))
PY

streams_json="$(api_curl 'http://127.0.0.1:1985/api/v1/streams/?start=0&count=10000')"
python3 - "$streams_json" "$TARGET_DIR/data/srs-manager.db" <<'PY'
import json, sqlite3, sys
streams = json.loads(sys.argv[1]).get('streams') or []
if streams:
    names = ','.join(str(x.get('name') or '?') for x in streams[:20])
    raise SystemExit("active media present: " + names)
with sqlite3.connect(sys.argv[2]) as db:
    for table in ("pull_tasks", "forward_tasks", "stream_transcode_bindings", "record_tasks"):
        cols = {row[1] for row in db.execute(f"PRAGMA table_info({table})")}
        if "desired_state" not in cols:
            continue
        count = db.execute(
            f"SELECT COUNT(*) FROM {table} WHERE desired_state='RUNNING'"
        ).fetchone()[0]
        if count:
            raise SystemExit(f"{table} desired RUNNING={count}")
print("active_media=0 desired_runtime=0")
PY

mkdir -p "$BACKUP_DIR"
cp -a "$MANAGER_ENV" "$BACKUP_DIR/manager.env"
cp -a "$SRS_CONF" "$BACKUP_DIR/srs.conf"
python3 - "$TARGET_DIR/data/srs-manager.db" "$BACKUP_DIR/settings-before.json" <<'PY'
import json, sqlite3, sys
keys = ('srs_api_url', 'srs_api_token')
with sqlite3.connect(sys.argv[1]) as db:
    state = {}
    for key in keys:
        row = db.execute('SELECT value FROM settings WHERE key=?', (key,)).fetchone()
        state[key] = {'exists': row is not None, 'value': row[0] if row else None}
with open(sys.argv[2], 'w') as f:
    json.dump(state, f)
PY

rollback() {
  local rc="${1:-$?}"
  trap - ERR EXIT
  if [[ "$ROLLBACK_ARMED" -ne 1 || "$ROLLBACK_COMPLETE" -eq 1 ]]; then
    exit "$rc"
  fi
  ROLLBACK_ARMED=0
  echo "hardening failed; restoring previous Manager env and SRS config" >&2
  cp -a "$BACKUP_DIR/manager.env" "$MANAGER_ENV"
  cp -a "$BACKUP_DIR/srs.conf" "$SRS_CONF"
  python3 - "$TARGET_DIR/data/srs-manager.db" "$BACKUP_DIR/settings-before.json" <<'PY' || true
import json, sqlite3, sys
with open(sys.argv[2]) as f:
    state = json.load(f)
with sqlite3.connect(sys.argv[1]) as db:
    for key, item in state.items():
        if item['exists']:
            db.execute('INSERT OR REPLACE INTO settings(key,value) VALUES (?,?)', (key, item['value']))
        else:
            db.execute('DELETE FROM settings WHERE key=?', (key,))
PY
  systemctl restart "$SRS_UNIT" || true
  for unit in "${MANAGER_UNITS[@]}"; do systemctl restart "$unit" || true; done
  exit "$rc"
}
ROLLBACK_ARMED=1
trap 'rollback $?' ERR EXIT

python3 - "$MANAGER_ENV" <<'PY'
import os, pathlib, re, secrets, sys
path = pathlib.Path(sys.argv[1])
lines = path.read_text().splitlines()
values = {}
for line in lines:
    raw = line.strip()
    if raw and not raw.startswith('#') and '=' in raw:
        key, value = raw.split('=', 1)
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":
            value = value[1:-1]
        values[key.strip()] = value

username = values.get('SRS_API_USERNAME', '')
if not re.fullmatch(r'[A-Za-z0-9._-]{1,64}', username):
    username = 'srs-manager'
password = values.get('SRS_API_PASSWORD', '')
if not re.fullmatch(r'[A-Za-z0-9._~-]{24,256}', password):
    password = secrets.token_hex(24)

updates = {
    'SRS_API_TOKEN': '',
    'SRS_API_USERNAME': username,
    'SRS_API_PASSWORD': password,
    'EXPOSE_SRS_HTTP_ORIGIN_URLS': '0',
}
seen = set()
out = []
for line in lines:
    if '=' in line and not line.lstrip().startswith('#'):
        key = line.split('=', 1)[0].strip()
        if key in updates:
            out.append(f'{key}={updates[key]}')
            seen.add(key)
            continue
    out.append(line)
for key, value in updates.items():
    if key not in seen:
        out.append(f'{key}={value}')
stat = path.stat()
tmp = path.with_suffix(path.suffix + '.tmp')
tmp.write_text('\n'.join(out) + '\n')
os.chmod(tmp, stat.st_mode & 0o777)
os.chown(tmp, stat.st_uid, stat.st_gid)
os.replace(tmp, path)
PY

api_token=""
api_user="$(env_value SRS_API_USERNAME)"
api_pass="$(env_value SRS_API_PASSWORD)"
[[ "$api_user" =~ ^[A-Za-z0-9._-]{1,64}$ ]] || fail "unsafe generated SRS API username"
[[ "$api_pass" =~ ^[A-Za-z0-9._~-]{24,256}$ ]] || fail "unsafe generated SRS API password"

python3 - "$TARGET_DIR/data/srs-manager.db" <<'PY'
import sqlite3, sys
with sqlite3.connect(sys.argv[1]) as db:
    db.execute("DELETE FROM settings WHERE key='srs_api_token'")
    db.execute(
        "INSERT OR REPLACE INTO settings(key,value) VALUES ('srs_api_url',?)",
        ('http://127.0.0.1:1985/api/v1',),
    )
PY

python3 - "$SRS_CONF" "$api_user" "$api_pass" <<'PY'
import pathlib, re, sys

path = pathlib.Path(sys.argv[1])
username, password = sys.argv[2], sys.argv[3]
lines = path.read_text().splitlines(keepends=True)

def block_bounds(name):
    start = None
    depth = 0
    pattern = re.compile(rf'^\s*{re.escape(name)}\s*\{{\s*(?:#.*)?$')
    for i, line in enumerate(lines):
        if start is None:
            if not pattern.match(line.rstrip('\n')):
                continue
            start = i
            depth = line.count('{') - line.count('}')
            continue
        depth += line.count('{') - line.count('}')
        if depth == 0:
            return start, i
    raise SystemExit(f'missing or unbalanced {name} block')

def patch_listen(name, endpoint):
    start, end = block_bounds(name)
    for i in range(start + 1, end):
        if re.match(r'^\s*listen\s+[^;]+;', lines[i]):
            indent = re.match(r'^(\s*)', lines[i]).group(1)
            lines[i] = f'{indent}listen          {endpoint};\n'
            return
    raise SystemExit(f'missing listen directive in {name}')
def patch_auth():
    start, end = block_bounds('http_api')
    block = lines[start:end + 1]
    for i in range(1, len(block) - 1):
        if not re.match(r'^\s*auth\s*\{', block[i]):
            continue
        depth = 0
        j = i
        while j < len(block):
            depth += block[j].count('{') - block[j].count('}')
            if depth == 0:
                break
            j += 1
        del block[i:j + 1]
        break
    auth = [
        '    auth {\n',
        '        enabled         on;\n',
        f'        username        {username};\n',
        f'        password        {password};\n',
        '    }\n',
    ]
    block[-1:-1] = auth
    lines[start:end + 1] = block

patch_listen('http_api', '127.0.0.1:1985')
patch_auth()
patch_listen('http_server', '127.0.0.1:8080')
path.write_text(''.join(lines))
PY

(cd "$SRS_DIR" && ASAN_OPTIONS=detect_leaks=0 ./objs/srs -t -c "$SRS_CONF" >/dev/null)

for unit in "${MANAGER_UNITS[@]}"; do systemctl restart "$unit"; done
for unit in "${MANAGER_UNITS[@]}"; do systemctl is-active --quiet "$unit"; done
manager_ready=0
for _ in $(seq 1 30); do
  if curl -fsS --max-time 2 http://127.0.0.1:3001/api/health 2>/dev/null | grep -q '"status":"ok"'; then
    manager_ready=1
    break
  fi
  sleep 1
done
[[ "$manager_ready" -eq 1 ]] || fail "Manager health did not recover after restart"

systemctl restart "$SRS_UNIT"
systemctl is-active --quiet "$SRS_UNIT"

srs_ready=0
unauth_code=000
for _ in $(seq 1 30); do
  unauth_code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 2 http://127.0.0.1:1985/api/v1/versions 2>/dev/null || true)"
  if [[ "$unauth_code" == "401" ]]; then
    srs_ready=1
    break
  fi
  sleep 1
done
[[ "$srs_ready" -eq 1 ]] || fail "SRS API did not become ready with auth; last HTTP $unauth_code"

auth_body="$(curl -fsS --max-time 3 -u "$api_user:$api_pass" http://127.0.0.1:1985/api/v1/versions)"
python3 - "$auth_body" <<'PY'
import json, sys
payload = json.loads(sys.argv[1])
if payload.get('code') != 0:
    raise SystemExit('authenticated SRS API probe failed')
PY
curl -fsS --max-time 3 http://127.0.0.1:8080/ >/dev/null

for port in 1985 8080; do
  mapfile -t listeners < <(ss -H -ltn | awk -v p=":$port" '$4 ~ p"$" {print $4}')
  ((${#listeners[@]} > 0)) || fail "no listener found for $port"
  for addr in "${listeners[@]}"; do
    [[ "$addr" == "127.0.0.1:$port" ]] || fail "unexpected non-loopback listener for $port: $addr"
  done
done

for unit in "${MANAGER_UNITS[@]}"; do systemctl is-active --quiet "$unit"; done
curl -fsS --max-time 3 http://127.0.0.1:3001/api/health >/dev/null

(cd "$TARGET_DIR" && env \
  SRS_API_URL=http://127.0.0.1:1985/api/v1 \
  SRS_API_TOKEN= \
  SRS_API_USERNAME="$api_user" \
  SRS_API_PASSWORD="$api_pass" \
  DATA_DIR="$TARGET_DIR/data" \
  node - <<'NODE'
const srs = require('./backend/services/srs');
srs.getVersion()
  .then(data => {
    if (data?.code !== 0) throw new Error('unexpected SRS API response');
    console.log('manager_srs_client=ok');
  })
  .catch(error => { console.error(error.message); process.exit(1); });
NODE
)

streams_after="$(curl -fsS --max-time 3 -u "$api_user:$api_pass" 'http://127.0.0.1:1985/api/v1/streams/?start=0&count=10000')"
python3 - "$streams_after" <<'PY'
import json, sys
streams = json.loads(sys.argv[1]).get('streams') or []
if streams:
    raise SystemExit('stream appeared during hardening')
print('active_streams_after=0')
PY

ROLLBACK_COMPLETE=1
ROLLBACK_ARMED=0
trap - ERR EXIT
echo "SRS origin hardening PASS"
echo "http_api=127.0.0.1:1985 basic-auth"
echo "http_server=127.0.0.1:8080"
echo "backup=$BACKUP_DIR"
