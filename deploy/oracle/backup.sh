#!/usr/bin/env bash
# Nightly (systemd timer from setup.sh, 02:30 IST): a backup of this VM's database, kept 14 days in
# /var/backups/dev-resolve — and, once a Neon address is saved with `backup.sh --set-neon`, the same copy restored into
# Neon, so there's always an up-to-date copy off this VM (it needs a few minutes of Neon time a day).
# Restore here from a file:  sudo cat <file>.dump | dr exec -T postgres pg_restore --clean --if-exists --no-owner --no-acl -U dev_resolve_owner -d dev_resolve
set -euo pipefail
ETC=/etc/dev-resolve
BK=/var/backups/dev-resolve
if [ "${1:-}" = --set-neon ]; then
  read -rsp "Paste the Neon connection string (input hidden): " url; echo
  url="${url%%\?*}"  # drop ?sslmode=…&channel_binding=… — set below
  [[ "$url" =~ ^postgres(ql)?:// ]] || { echo "That doesn't look like a Postgres connection string"; exit 1; }
  echo "NEON_BACKUP_URL=$url?sslmode=require" | sudo tee "$ETC/neon.env" >/dev/null && sudo chmod 600 "$ETC/neon.env"
  echo "Saved. Running a backup now to check it works…"
fi
sudo mkdir -p "$BK" && sudo chmod 700 "$BK"
OUT="$BK/dev_resolve-$(date -u +%Y%m%d-%H%M%S).dump"
/usr/local/bin/dr exec -T postgres pg_dump --format=custom --no-owner --no-acl -U postgres dev_resolve | sudo tee "$OUT" >/dev/null
sudo chmod 600 "$OUT"
sudo find "$BK" -name 'dev_resolve-*.dump' -mtime +14 -delete
echo "[backup] local: $OUT ($(sudo du -h "$OUT" | cut -f1))"
NEON=$(sudo sed -n 's/^NEON_BACKUP_URL=//p' "$ETC/neon.env" 2>/dev/null || true)
if [ -n "$NEON" ]; then
  sudo cat "$OUT" | sudo docker run --rm -i postgres:17-alpine pg_restore --clean --if-exists --no-owner --no-acl -d "$NEON" \
    && echo "[backup] Neon: up to date" || { echo "[backup] Neon: copy FAILED (the local backup above is fine)"; exit 1; }
fi
