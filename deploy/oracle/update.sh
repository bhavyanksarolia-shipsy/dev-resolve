#!/usr/bin/env bash
# Every 5 min (systemd timer from setup.sh): deploy new commits on main. Rebuilds the backend only when the backend or
# this folder changed (the frontend deploys on Vercel). Safe by design:
#   - a failed build changes nothing (the running version keeps running);
#   - a new version that isn't healthy within 3 min is replaced by the previous one automatically.
# Put the previous version back by hand:  sudo /opt/dev-resolve/deploy/oracle/update.sh --previous
set -euo pipefail
DIR=/opt/dev-resolve
cd "$DIR"
healthy() { # wait up to 3 min for the app container's health check
  for _ in $(seq 1 36); do
    id=$(/usr/local/bin/dr ps -q app 2>/dev/null || true)
    [ -n "$id" ] && [ "$(docker inspect -f '{{.State.Health.Status}}' "$id" 2>/dev/null)" = healthy ] && return 0
    sleep 5
  done
  return 1
}
back_to_previous() {
  docker image inspect dev-resolve:previous >/dev/null 2>&1 || { echo "[update] no previous version kept"; return 1; }
  docker tag dev-resolve:previous dev-resolve:latest
  /usr/local/bin/dr up -d --no-build app
  healthy && echo "[update] previous version is running again"
}
if [ "${1:-}" = --previous ]; then back_to_previous; exit; fi

git fetch -q origin main
target=$(git rev-parse origin/main)
[ "$(git rev-parse HEAD)" = "$target" ] && exit 0
BAD=/var/lib/dev-resolve-bad-commit   # a commit that failed is skipped until a newer one arrives
[ "$(cat "$BAD" 2>/dev/null)" = "$target" ] && exit 0
was=$(git rev-parse --short HEAD)
changed=$(git diff --name-only HEAD origin/main -- apps/api deploy/oracle | wc -l)
git reset -q --hard origin/main
chmod 755 deploy/oracle/*.sh
if [ "$changed" -eq 0 ]; then echo "[update] $(git log -1 --format=%h): frontend only — nothing to rebuild here"; exit 0; fi

echo "[update] deploying $(git log -1 --format='%h %s')"
docker image inspect dev-resolve:latest >/dev/null 2>&1 && docker tag dev-resolve:latest dev-resolve:previous
if ! /usr/local/bin/dr build app; then
  echo "[update] build FAILED — still running the earlier version"; echo "$target" > "$BAD"; git reset -q --hard "$was"; exit 1
fi
/usr/local/bin/dr up -d app caddy
if healthy; then
  echo "[update] $(git log -1 --format=%h) is running"
  docker image prune -f >/dev/null
else
  echo "[update] new version NOT healthy after 3 min — putting the previous one back"
  /usr/local/bin/dr logs --tail 60 app || true
  back_to_previous
  echo "$target" > "$BAD"; git reset -q --hard "$was"   # not retried every 5 min; the next new commit is tried
  exit 1
fi
