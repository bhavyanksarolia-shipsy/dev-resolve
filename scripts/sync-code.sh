#!/usr/bin/env bash
# Keep the code the agent reads (CODE_ROOT/<repo>) in sync with GitHub — read-only, shallow, latest branch only.
#   CODE_ROOT         where repos live (default ./code)
#   CODE_GIT_BASE     e.g. https://github.com/<org>   (the repos named in projects.json "code_repos")
#   CODE_GIT_BRANCH   default main
#   GITHUB_TOKEN      fine-grained, read-only "Contents" on just those repos. Sent per request as a header —
#                     never written into .git/config or the remote URL.
# Run at start and on a timer (the Docker image does both, see scripts/docker-entrypoint.sh).
set -euo pipefail
cd "$(dirname "$0")/.."
: "${CODE_GIT_BASE:?Set CODE_GIT_BASE, e.g. https://github.com/<org>}"
ROOT_DIR="${CODE_ROOT:-./code}"; BRANCH="${CODE_GIT_BRANCH:-main}"
CFG="${DEV_RESOLVE_CONFIG_DIR:-config}/projects.json"
mkdir -p "$ROOT_DIR"
AUTH=()
if [ -n "${GITHUB_TOKEN:-}" ]; then
  AUTH=(-c "http.extraHeader=Authorization: Basic $(printf 'x-access-token:%s' "$GITHUB_TOKEN" | base64 | tr -d '\n')")
fi
REPOS=$(python3 -c "import json,sys; a=json.load(open(sys.argv[1]))['accounts']; print('\n'.join(sorted({r for x in a for r in (x.get('code_repos') or [])})))" "$CFG")
fail=0
for repo in $REPOS; do
  dir="$ROOT_DIR/$repo"
  if [ -d "$dir/.git" ]; then
    if git "${AUTH[@]}" -C "$dir" fetch --quiet --depth 1 origin "$BRANCH" && git -C "$dir" reset --quiet --hard FETCH_HEAD; then
      echo "updated $repo → $(git -C "$dir" log -1 --format='%h %cd' --date=short)"
    else echo "FAILED to update $repo (kept the previous copy)" >&2; fail=1; fi
  else
    if git "${AUTH[@]}" clone --quiet --depth 1 --single-branch --branch "$BRANCH" "$CODE_GIT_BASE/$repo.git" "$dir"; then
      echo "cloned $repo → $(git -C "$dir" log -1 --format='%h %cd' --date=short)"
    else echo "FAILED to clone $repo — check GITHUB_TOKEN has read access to it" >&2; fail=1; fi
  fi
done
date -u +%FT%TZ > "$ROOT_DIR/.last-sync"
exit $fail
