#!/usr/bin/env bash
# Run on your Mac (Railway CLI signed in and linked to the Dev Resolve project):
#   deploy/oracle/send-env.sh <vm-public-ip> [ssh-key-file]
# Copies the backend's settings from Railway straight to the VM (/etc/dev-resolve/app.env) and the Railway database's
# public address (for the one-time data copy). Values go from Railway to the VM through SSH — never printed, never
# written on this Mac. Railway-only and database settings are left out; the VM has its own database.
set -euo pipefail
IP="${1:?usage: send-env.sh <vm-public-ip> [ssh-key-file]}"
SSH=(ssh -o StrictHostKeyChecking=accept-new ${2:+-i "$2"} "ubuntu@$IP")
SERVICE="${RAILWAY_SERVICE:-dev-resolve}" DB_SERVICE="${RAILWAY_DB_SERVICE:-Postgres}"

railway status >/dev/null 2>&1 || { echo "Railway CLI isn't linked here — run: railway link  (pick the Dev Resolve project), then again"; exit 1; }

DROP='^(RAILWAY_[A-Z_]*|PORT|HOSTNAME|NODE_ENV|DATABASE_URL|MIGRATION_DATABASE_URL|DATABASE_SSL|DATABASE_CA_CERT|DATABASE_PUBLIC_URL|BACKEND_PUBLIC_URL|INTERNAL_URL|PG[A-Z]*|POSTGRES_[A-Z_]*)='
n=$(railway variables --service "$SERVICE" --kv | grep -cvE "$DROP" || true)
railway variables --service "$SERVICE" --kv | grep -vE "$DROP" \
  | "${SSH[@]}" 'sudo sh -c "umask 077; cat > /etc/dev-resolve/app.env"'
echo "copied $n settings from Railway ($SERVICE) to the VM"

railway variables --service "$DB_SERVICE" --kv | grep -E '^DATABASE_PUBLIC_URL=' | sed 's/^DATABASE_PUBLIC_URL=/RAILWAY_DATABASE_URL=/' \
  | "${SSH[@]}" 'sudo sh -c "umask 077; cat > /etc/dev-resolve/railway-db.env"'
"${SSH[@]}" 'sudo grep -q "^RAILWAY_DATABASE_URL=postgres" /etc/dev-resolve/railway-db.env' \
  && echo "copied the Railway database address (for the one-time data copy)" \
  || echo "couldn't find the Railway database's public address — in Railway: Postgres → Settings → Networking → enable the public (TCP proxy) address, then run this again"
echo "Next, on the VM:  /opt/dev-resolve/deploy/oracle/migrate-db.sh"
