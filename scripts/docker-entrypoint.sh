#!/usr/bin/env bash
# Container start: prepare the /data volume → migrate the DB → sync code from GitHub (then every 30 min) → run the app.
set -euo pipefail
cd /app
if [ "$(id -u)" = 0 ]; then
  mkdir -p /data
  [ "$(stat -c %U /data)" = node ] || chown node:node /data
  for d in config knowledge auth logs code; do mkdir -p "/data/$d"; [ "$(stat -c %U "/data/$d")" = node ] || chown -R node:node "/data/$d"; done
  exec setpriv --reuid=node --regid=node --init-groups env HOME=/home/node "$0" "$@"
fi
mkdir -p /data/config /data/knowledge /data/auth /data/logs /data/code
chmod 700 /data/config /data/auth
# First start: seed the knowledge templates; config must be provided by you (copied onto the volume or mounted).
cp -rn /app/knowledge-defaults/. /data/knowledge/ 2>/dev/null || true

# Secret files (Render "Secret Files", or any read-only mount at $SECRETS_DIR): copied onto the disk when new or
# changed since the last copy. The app also writes these at runtime (client on/off, refreshed sessions), so an
# unchanged secret file never overwrites the disk copy.
SECRETS_DIR="${SECRETS_DIR:-/etc/secrets}"
seed() { # $1 = secret file, $2 = destination
  [ -f "$SECRETS_DIR/$1" ] || return 0
  local sum; sum=$(sha256sum "$SECRETS_DIR/$1" | cut -d' ' -f1)
  if [ "$(cat "/data/config/.seeded-$1" 2>/dev/null)" != "$sum" ]; then
    if [ "$1" = knowledge.tgz.b64 ]; then base64 -d "$SECRETS_DIR/$1" | tar -xz -C /data/knowledge --keep-newer-files 2>/dev/null || true
    else cp "$SECRETS_DIR/$1" "$2" && chmod 600 "$2"; fi
    echo "$sum" > "/data/config/.seeded-$1"; echo "[start] loaded $1 from secret files"
  fi
}
seed projects.json /data/config/projects.json
seed config.env /data/config/config.env
seed knowledge.tgz.b64 /data/knowledge
# Wait (instead of exiting) until the private config is on the volume, so it can be copied in with `docker cp`.
until [ -f /data/config/projects.json ] && [ -f /data/config/config.env ]; do
  echo "[start] waiting for /data/config/projects.json and config.env — copy them in (see DEPLOY.md)" >&2
  sleep 15
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
