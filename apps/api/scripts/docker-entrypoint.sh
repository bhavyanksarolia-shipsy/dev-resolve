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
exec npx next start -H "${HOSTNAME:-0.0.0.0}" -p "${PORT:-3000}"
