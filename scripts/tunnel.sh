#!/usr/bin/env bash
# Cloudflare link for Dev Resolve: on | off | status. Off by default; the app keeps running either way.
set -uo pipefail
cd "$(dirname "$0")/.."
PORT="${PORT:-3001}"
LOGS="$(pwd)/.logs"; mkdir -p "${LOGS}"
PIDF="${LOGS}/tunnel.pid"
PATTERN="cloudflared tunnel --no-autoupdate --url http://localhost:${PORT}"

running() { [ -f "${PIDF}" ] && kill -0 "$(cat "${PIDF}")" 2>/dev/null; }
url() { grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "${LOGS}/tunnel.log" 2>/dev/null | head -1; }

case "${1:-status}" in
  on)
    command -v cloudflared >/dev/null || { echo "cloudflared not installed: brew install cloudflared"; exit 1; }
    curl -s -o /dev/null "http://localhost:${PORT}/login" || { echo "Dev Resolve isn't running on port ${PORT} — start it first: npm run up"; exit 1; }
    if running; then echo "Cloudflare link is already ON: $(url)"; exit 0; fi
    pkill -f "${PATTERN}" 2>/dev/null || true
    : > "${LOGS}/tunnel.log"
    nohup cloudflared tunnel --no-autoupdate --url "http://localhost:${PORT}" >"${LOGS}/tunnel.log" 2>&1 &
    echo $! > "${PIDF}"
    for _ in $(seq 1 40); do [ -n "$(url)" ] && break; sleep 1; done
    if [ -n "$(url)" ]; then
      echo "Cloudflare link ON: $(url)"
      echo "(new random address each time — share it with your colleague; turn off with: npm run tunnel:off)"
    else
      echo "Tunnel didn't come up — see .logs/tunnel.log"; exit 1
    fi
    ;;
  off)
    if running; then kill "$(cat "${PIDF}")" 2>/dev/null; fi
    pkill -f "${PATTERN}" 2>/dev/null || true
    rm -f "${PIDF}"
    echo "Cloudflare link OFF (Wi-Fi and localhost still work)"
    ;;
  status)
    if running; then echo "Cloudflare link: ON  → $(url)"; else echo "Cloudflare link: OFF  (turn on: npm run tunnel:on)"; fi
    ;;
  *) echo "usage: scripts/tunnel.sh on|off|status"; exit 1 ;;
esac
