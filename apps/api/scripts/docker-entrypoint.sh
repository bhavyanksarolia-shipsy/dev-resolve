#!/usr/bin/env bash
# Container start: migrate the DB → restore private files from it → run the app (which syncs code from GitHub).
set -euo pipefail
cd /app
if [ "$(id -u)" = 0 ]; then
  mkdir -p /data
  [ "$(stat -c %U /data)" = node ] || chown node:node /data
  for d in knowledge auth logs code; do mkdir -p "/data/$d"; [ "$(stat -c %U "/data/$d")" = node ] || chown -R node:node "/data/$d"; done
  exec setpriv --reuid=node --regid=node --init-groups env HOME=/home/node "$0" "$@"
fi
mkdir -p /app/config /data/knowledge /data/auth /data/logs /data/code
chmod 700 /app/config /data/auth
# Seed the public knowledge templates (README, _template, _shared).
cp -rn /app/knowledge-defaults/. /data/knowledge/ 2>/dev/null || true

# Secret files (Render "Secret Files", or any read-only mount at $SECRETS_DIR): copied onto the disk when new or
# changed since the last copy. The app also writes these at runtime (client on/off, refreshed sessions), so an
# unchanged secret file never overwrites the disk copy.
SECRETS_DIR="${SECRETS_DIR:-/etc/secrets}"
seed() { # $1 = secret file, $2 = destination
  [ -f "$SECRETS_DIR/$1" ] || return 0
  local sum; sum=$(sha256sum "$SECRETS_DIR/$1" | cut -d' ' -f1)
  if [ "$(cat "/data/.seeded-$1" 2>/dev/null)" != "$sum" ]; then
    if [ "$1" = knowledge.tgz.b64 ]; then base64 -d "$SECRETS_DIR/$1" | tar -xz -C /data/knowledge --keep-newer-files 2>/dev/null || true
    else cp "$SECRETS_DIR/$1" "$2" && chmod 600 "$2"; fi
    echo "$sum" > "/data/.seeded-$1"; echo "[start] loaded $1 from secret files"
  fi
}
seed projects.json /app/config/projects.json
seed config.env /app/config/config.env
seed knowledge.tgz.b64 /data/knowledge
# Private files come from Postgres (restored below, after migrations). On a brand-new database the app still starts
# with no accounts, and an admin uploads the config once on the Settings page — it's kept in the database from then on.
: "${DATABASE_URL:?DATABASE_URL is not set}"
# Missing DevRev token: start anyway (sign-in + Settings uploads work); the DevRev health check shows what to set.
[ -n "${DEVREV_TOKEN:-}" ] || echo "[start] DEVREV_TOKEN is not set — add it in the service's variables" >&2

echo "[start] migrating database…"
npm run --silent db:migrate
echo "[start] loading private files from the database…"
npm run --silent private -- restore

# Code from GitHub is synced by the app itself (src/lib/codeSync.ts) — settings can come from the variables or Admin.

echo "[start] Dev Resolve on :${PORT:-3000}"
# Cap V8's own heap well under the container's memory limit: left unbounded, Node sizes its heap off the host's
# total RAM (not the cgroup limit), grows until the kernel SIGKILLs the whole container with no diagnostic at all —
# just "Killed" and nothing else. With a cap, a real leak crashes with an actual heap-overflow error we can read,
# and normal GC kicks in earlier instead of riding all the way up to the ceiling. Other processes in this container
# (the Python MCP log server, the spawned Claude CLI) have their own memory and aren't bounded by this flag — it
# only governs this one long-running Next.js process, the one that's actually been getting OOM-killed.
export NODE_OPTIONS="${NODE_OPTIONS:-} --max-old-space-size=640"
exec npx next start -H "${HOSTNAME:-0.0.0.0}" -p "${PORT:-3000}"
