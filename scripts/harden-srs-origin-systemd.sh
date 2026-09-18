#!/usr/bin/env bash
set -Eeuo pipefail

SRS_UNIT="${SRS_UNIT:-srs.service}"
MANAGER_ENV="${MANAGER_ENV:-/home/ubuntu/srs-manager/.env}"
DROPIN_DIR="/etc/systemd/system/${SRS_UNIT}.d"
DROPIN_FILE="${DROPIN_DIR}/20-srs-manager-origin-hardening.conf"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_FILE="/tmp/${SRS_UNIT}.origin-hardening.${STAMP}.bak"
HAD_DROPIN=0

fail() { echo "ERROR: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || fail "missing dependency: $1"; }

[[ "${EUID:-$(id -u)}" -eq 0 ]] || fail "run as root"
for cmd in curl python3 systemctl install ss; do need "$cmd"; done
[[ -f "$MANAGER_ENV" ]] || fail "manager env not found: $MANAGER_ENV"
systemctl is-active --quiet "$SRS_UNIT" || fail "$SRS_UNIT is not active"

token="$(python3 - "$MANAGER_ENV" <<'PY'
import pathlib, sys
for raw in pathlib.Path(sys.argv[1]).read_text().splitlines():
    line = raw.strip()
    if not line or line.startswith('#') or '=' not in line:
        continue
    key, value = line.split('=', 1)
    if key.strip() == 'SRS_API_TOKEN':
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":
            value = value[1:-1]
        print(value)
        break
PY
)"
[[ "$token" =~ ^[A-Za-z0-9._~-]{16,256}$ ]] || fail "SRS_API_TOKEN must be 16-256 safe characters"

srs_get() {
  local url="$1" body
  if body="$(curl -fsS --max-time 3 "$url" 2>/dev/null)"; then
    printf '%s' "$body"
    return 0
  fi
  curl -fsS --max-time 3 -H "Authorization: Bearer $token" "$url"
}

version_json="$(srs_get http://127.0.0.1:1985/api/v1/versions)"
python3 - "$version_json" <<'PY'
import json, sys
payload = json.loads(sys.argv[1])
data = payload.get('data') or {}
major = int(data.get('major') or 0)
minor = int(data.get('minor') or 0)
revision = int(data.get('revision') or 0)
version = (major, minor, revision)
supported = ((5, 0, 152) <= version < (6, 0, 0)) or version >= (6, 0, 40)
if not supported:
    raise SystemExit(f"SRS {major}.{minor}.{revision} lacks supported HTTP API auth")
print(f"srs_version={major}.{minor}.{revision}")
PY

streams_json="$(srs_get 'http://127.0.0.1:1985/api/v1/streams/?start=0&count=10000')"
python3 - "$streams_json" <<'PY'
import json, sys
payload = json.loads(sys.argv[1])
streams = payload.get('streams') or []
if streams:
    names = ','.join(str(x.get('name') or '?') for x in streams[:20])
    raise SystemExit(f"active media present; refusing SRS restart: {names}")
print("active_streams=0")
PY

if [[ -f "$DROPIN_FILE" ]]; then
  HAD_DROPIN=1
  cp -a "$DROPIN_FILE" "$BACKUP_FILE"
fi

rollback() {
  local rc=$?
  trap - ERR
  echo "hardening failed; restoring previous SRS unit override" >&2
  if [[ "$HAD_DROPIN" -eq 1 ]]; then
    cp -a "$BACKUP_FILE" "$DROPIN_FILE"
  else
    rm -f "$DROPIN_FILE"
  fi
  systemctl daemon-reload
  systemctl restart "$SRS_UNIT" || true
  exit "$rc"
}
trap rollback ERR

install -d -o root -g root -m 0755 "$DROPIN_DIR"
tmp="$(mktemp)"
chmod 0600 "$tmp"
cat >"$tmp" <<EOF
[Service]
Environment="SRS_HTTP_API_LISTEN=127.0.0.1:1985"
Environment="SRS_HTTP_SERVER_LISTEN=127.0.0.1:8080"
Environment="SRS_HTTP_API_AUTH_ENABLED=on"
Environment="SRS_HTTP_API_AUTH_TYPE=bearer"
Environment="SRS_HTTP_API_AUTH_TOKEN=$token"
EOF
install -o root -g root -m 0600 "$tmp" "$DROPIN_FILE"
rm -f "$tmp"

systemctl daemon-reload
systemctl restart "$SRS_UNIT"
systemctl is-active --quiet "$SRS_UNIT"

unauth_code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 3 http://127.0.0.1:1985/api/v1/versions || true)"
[[ "$unauth_code" == "401" || "$unauth_code" == "403" ]] || fail "SRS API still accepts unauthenticated requests: HTTP $unauth_code"

auth_body="$(curl -fsS --max-time 3 -H "Authorization: Bearer $token" http://127.0.0.1:1985/api/v1/versions)"
python3 - "$auth_body" <<'PY'
import json, sys
payload = json.loads(sys.argv[1])
if payload.get('code') != 0:
    raise SystemExit("authenticated SRS API probe failed")
PY
curl -fsS --max-time 3 http://127.0.0.1:8080/ >/dev/null

for port in 1985 8080; do
  mapfile -t listeners < <(ss -H -ltn | awk -v p=":$port" '$4 ~ p"$" {print $4}')
  ((${#listeners[@]} > 0)) || fail "no listener found for $port"
  for addr in "${listeners[@]}"; do
    [[ "$addr" == "127.0.0.1:$port" ]] || fail "unexpected non-loopback listener for $port: $addr"
  done
done

trap - ERR
rm -f "$BACKUP_FILE"
echo "SRS origin hardening PASS"
echo "http_api=127.0.0.1:1985 bearer"
echo "http_server=127.0.0.1:8080"
