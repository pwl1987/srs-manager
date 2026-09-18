#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

branch="$(git branch --show-current)"
[[ "$branch" == "main" ]] || { echo "ERROR: current branch must be main, got: $branch" >&2; exit 2; }
[[ -z "$(git status --porcelain)" ]] || { echo "ERROR: working tree must be clean" >&2; exit 2; }

sha="$(git rev-parse HEAD)"
short="${sha:0:12}"
tag="gate/${short}"
repo="$(gh repo view --json nameWithOwner -q .nameWithOwner)"

echo "Preflight candidate: $sha"
git push origin "${sha}:refs/tags/${tag}"

cleanup() {
  git push origin ":refs/tags/${tag}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

required=("Backend Tests" "Frontend Build" "Static Analysis" "Container Build" "Delta Coverage" "Contract Tests")
deadline=$((SECONDS + 1200))

while (( SECONDS < deadline )); do
  mapfile -t rows < <(gh api "repos/${repo}/commits/${sha}/check-runs" --jq '.check_runs[] | [.name,.status,(.conclusion // "")] | @tsv')
  all_done=1
  failed=0
  for name in "${required[@]}"; do
    row="$(printf '%s\n' "${rows[@]:-}" | awk -F '\t' -v n="$name" '$1==n {print; exit}')"
    if [[ -z "$row" ]]; then all_done=0; continue; fi
    status="$(cut -f2 <<<"$row")"
    conclusion="$(cut -f3 <<<"$row")"
    [[ "$status" == "completed" ]] || { all_done=0; continue; }
    case "$conclusion" in success|neutral|skipped) ;; *) failed=1 ;; esac
  done

  if (( failed )); then
    echo "ERROR: required gate failed for $sha" >&2
    printf '%s\n' "${rows[@]}"
    exit 1
  fi
  if (( all_done )); then
    echo "All required gates passed. Updating protected main."
    git push origin main
    exit 0
  fi
  sleep 10
done

echo "ERROR: timed out waiting for required checks" >&2
exit 1
