#!/usr/bin/env bash
set -euo pipefail

HOST="${1:-${SRS_PROBE_HOST:-}}"
[[ -n "$HOST" ]] || { echo "usage: $0 <srs-host>" >&2; exit 2; }
HTTP_PORT="${SRS_HTTP_PORT:-8080}"
API_PORT="${SRS_API_PORT:-1985}"

probe_blocked() {
  local port="$1" path="$2" label="$3"
  local code
  set +e
  code="$(curl -sS -o /dev/null -w '%{http_code}' --connect-timeout 2 --max-time 4 "http://${HOST}:${port}${path}" 2>/dev/null)"
  local rc=$?
  set -e
  if [[ "$rc" -eq 0 ]]; then
    echo "FAIL: $label reachable at ${HOST}:${port} (HTTP ${code})" >&2
    return 1
  fi
  echo "PASS: $label not reachable at ${HOST}:${port}"
}

failed=0
probe_blocked "$HTTP_PORT" "/" "SRS HTTP origin" || failed=1
probe_blocked "$API_PORT" "/api/v1/versions" "SRS HTTP API" || failed=1

if [[ "$failed" -ne 0 ]]; then
  echo "SRS origin exposure gate FAILED" >&2
  exit 1
fi
echo "SRS origin exposure gate PASS"
