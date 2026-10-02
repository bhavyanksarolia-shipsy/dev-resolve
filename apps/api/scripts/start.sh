#!/usr/bin/env bash
# Run Dev Resolve locally the way it's deployed: backend (apps/api) + frontend (apps/web, forwards /api to the backend).
#   npm run up            (from the repo root)        Ctrl+C stops everything.
# Ports: API_PORT (default 3002), WEB_PORT (default 3001) — or PORT / WEB_PORT in apps/api/.env.local.
# Prereq you do yourself: connect the client VPN (see VPN_HINT in config/config.env) for VPN-only logs/Metabase.
set -euo pipefail
API_DIR="$(cd "$(dirname "$0")/.." && pwd)"; WEB_DIR="$(cd "$API_DIR/../web" && pwd)"
cd "$API_DIR"
envval() { { grep -E "^$1=" .env.local 2>/dev/null || true; } | tail -1 | cut -d= -f2-; }
API_PORT="${API_PORT:-$(envval PORT)}"; API_PORT="${API_PORT:-3002}"
WEB_PORT="${WEB_PORT:-$(envval WEB_PORT)}"; WEB_PORT="${WEB_PORT:-3001}"
LOGS="$API_DIR/.logs"; mkdir -p "$LOGS"
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

# 2. Free the ports if old copies are still running
for p in "$API_PORT" "$WEB_PORT"; do
  if lsof -ti tcp:"$p" >/dev/null 2>&1; then say "Stopping the old server on port ${p}…"; lsof -ti tcp:"$p" | xargs kill 2>/dev/null || true; sleep 1; fi
done

cleanup() { say "Stopping Dev Resolve…"; kill "${API_PID:-}" "${WEB_PID:-}" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

# 3. Backend, then frontend (pointed at it)
say "Starting the backend on :${API_PORT}…"
PORT="$API_PORT" npx next dev -p "$API_PORT" >"$LOGS/api.log" 2>&1 & API_PID=$!
say "Starting the frontend on :${WEB_PORT}…"
( cd "$WEB_DIR" && BACKEND_URL="http://localhost:${API_PORT}" npx next dev -H 0.0.0.0 -p "$WEB_PORT" ) >"$LOGS/web.log" 2>&1 & WEB_PID=$!
for _ in $(seq 1 90); do grep -q "Ready" "$LOGS/api.log" 2>/dev/null && grep -q "Ready" "$LOGS/web.log" 2>/dev/null && break; sleep 1; done

LAN_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "?")
echo
say "Dev Resolve is running"
echo "  Open:            http://localhost:${WEB_PORT}        (same Wi-Fi: http://${LAN_IP}:${WEB_PORT})"
echo "  Backend (API):   http://localhost:${API_PORT}"
echo "  Logins:          npm run user -- list   (add / reset / disable users there)"
echo "  Logs:            apps/api/.logs/api.log · apps/api/.logs/web.log"
echo "  VPN:             $(grep '^VPN_HINT=' config/config.env 2>/dev/null | cut -d= -f2- || echo 'connect the client VPN') — header chips turn green when logs/DB are reachable"
echo
say "Press Ctrl+C to stop everything."
wait "$API_PID" "$WEB_PID"
