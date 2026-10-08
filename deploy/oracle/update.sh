#!/usr/bin/env bash
# Every 5 min (systemd timer from setup.sh): deploy new commits on main. Rebuilds the backend only when the backend or
# this folder changed (the frontend deploys on Vercel). A failed build leaves the running version as it is.
set -euo pipefail
DIR=/opt/dev-resolve
cd "$DIR"
git fetch -q origin main
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] && exit 0
changed=$(git diff --name-only HEAD origin/main -- apps/api deploy/oracle | wc -l)
git reset -q --hard origin/main
chmod 755 deploy/oracle/*.sh
if [ "$changed" -gt 0 ]; then
  echo "[update] deploying $(git log -1 --format='%h %s')"
  /usr/local/bin/dr build app && /usr/local/bin/dr up -d app caddy
  docker image prune -f >/dev/null
else
  echo "[update] $(git log -1 --format=%h): frontend only — nothing to rebuild here"
fi
