#!/usr/bin/env bash
# Container start: prepare the /data volume → migrate the DB → sync code from GitHub (then every 30 min) → run the app.
set -euo pipefail
cd /app
mkdir -p /data/config /data/knowledge /data/auth /data/logs /data/code
chmod 700 /data/config /data/auth
# First start: seed the knowledge templates; config must be provided by you (copied onto the volume or mounted).
cp -rn /app/knowledge-defaults/. /data/knowledge/ 2>/dev/null || true
for f in projects.json config.env; do
  [ -f "/data/config/$f" ] || { echo "Missing /data/config/$f — copy your private config onto the volume (see DEPLOY.md)." >&2; exit 1; }
done
: "${DATABASE_URL:?DATABASE_URL is not set}"
: "${DEVREV_TOKEN:?DEVREV_TOKEN is not set}"

echo "[start] migrating database…"
npm run --silent db:migrate

if [ -n "${CODE_GIT_BASE:-}" ]; then
  echo "[start] syncing code from GitHub…"
  bash scripts/sync-code.sh || echo "[start] code sync failed — investigations still run, code reads use the last copy" >&2
  ( while sleep "${CODE_SYNC_SECONDS:-1800}"; do bash scripts/sync-code.sh >/dev/null || true; done ) &
else
  echo "[start] CODE_GIT_BASE not set — the agent can't read code (set it + GITHUB_TOKEN)" >&2
fi

echo "[start] Dev Resolve on :${PORT:-3000}"
exec npx next start -H "${HOSTNAME:-0.0.0.0}" -p "${PORT:-3000}"
