#!/usr/bin/env bash
# Start everything Dev Resolve needs (localhost + same Wi-Fi). Cloudflare link is OFF unless you pass --tunnel
# (or run `npm run tunnel:on` later). Ctrl+C stops it all.
# Prereq you do yourself: connect the Cisco AnyConnect "ril" VPN (tvpn.ril.com) for logs/Metabase.
set -euo pipefail
cd "$(dirname "$0")/.."
PORT="${PORT:-3001}"
LOGS="$(pwd)/.logs"; mkdir -p "$LOGS"
WITH_TUNNEL=0; [ "${1:-}" = "--tunnel" ] && WITH_TUNNEL=1

say() { printf '\033[1m%s\033[0m\n' "$*"; }

# 1. Docker + Postgres
if ! docker info >/dev/null 2>&1; then
  say "Starting Docker…"; open -a Docker
  for _ in $(seq 1 60); do docker info >/dev/null 2>&1 && break; sleep 2; done
  docker info >/dev/null 2>&1 || { echo "Docker didn't start — open Docker Desktop and re-run."; exit 1; }
fi
say "Starting Postgres…"
docker compose up -d postgres >/dev/null
for _ in $(seq 1 30); do docker exec dev-resolve-postgres pg_isready -U devresolve >/dev/null 2>&1 && break; sleep 1; done
npm run --silent db:migrate

# 2. Free the port if an old copy is still running
if lsof -ti tcp:"${PORT}" >/dev/null 2>&1; then
  say "Stopping the old server on port ${PORT}…"; lsof -ti tcp:"${PORT}" | xargs kill 2>/dev/null || true; sleep 1
fi
bash scripts/tunnel.sh off >/dev/null

cleanup() { say "Stopping Dev Resolve…"; kill "${APP_PID:-}" 2>/dev/null || true; bash scripts/tunnel.sh off >/dev/null; }
trap cleanup EXIT INT TERM

# 3. App (all interfaces, so the Wi-Fi URL works)
say "Starting the app…"
npx next dev -H 0.0.0.0 -p "${PORT}" >"$LOGS/app.log" 2>&1 & APP_PID=$!
for _ in $(seq 1 60); do grep -q "Ready" "$LOGS/app.log" 2>/dev/null && break; sleep 1; done

# 4. Cloudflare link — only when asked for
TUNNEL_LINE="OFF — turn on with: npm run tunnel:on"
if [ "$WITH_TUNNEL" = 1 ]; then
  say "Opening the Cloudflare link…"
  TUNNEL_LINE=$(bash scripts/tunnel.sh on | head -1 | sed 's/^Cloudflare link ON: //')
fi

LAN_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "?")
USER_LINE=$(grep '^DEV_RESOLVE_USERS=' .env.local | sed 's/^DEV_RESOLVE_USERS=//')
echo
say "Dev Resolve is running"
echo "  You:             http://localhost:${PORT}"
echo "  Same Wi-Fi:      http://${LAN_IP}:${PORT}"
echo "  Cloudflare link: ${TUNNEL_LINE}"
echo "  Login (name:pw): ${USER_LINE}"
echo "  Logs:            .logs/app.log · .logs/tunnel.log"
echo "  VPN:             connect 'ril' (tvpn.ril.com) — the header chips turn green when logs/DB are reachable"
echo
say "Press Ctrl+C to stop everything."
wait "$APP_PID"
