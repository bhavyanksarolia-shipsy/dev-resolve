#!/usr/bin/env bash
# Run on the VM after send-env.sh: copies all Dev Resolve data (investigations, users, config, knowledge, sign-ins —
# everything is in the database) from Railway into this VM's Postgres, checks every table's row count matches, then
# builds and starts Dev Resolve with HTTPS. Read-only on Railway. Add --again to replace data copied earlier.
set -euo pipefail
ETC=/etc/dev-resolve
BK=/var/backups/dev-resolve
say() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
SRC=$(sudo sed -n 's/^RAILWAY_DATABASE_URL=//p' "$ETC/railway-db.env" 2>/dev/null || true)
[ -n "$SRC" ] || { echo "No Railway database address yet — run deploy/oracle/send-env.sh on your Mac first"; exit 1; }
sudo grep -q '^DEVREV_TOKEN=\|^ANTHROPIC\|^CLAUDE_CODE_OAUTH_TOKEN=' "$ETC/app.env" || echo "note: app.env has no DevRev/Claude settings — that's fine if they're saved in Admin (they're in the database)"
pgtool() { sudo docker run --rm -i --network host postgres:17-alpine "$@"; }   # pg_dump/psql 17 read Postgres 9.2–17
local_sql() { dr exec -T postgres psql -U postgres -d dev_resolve -tA -v ON_ERROR_STOP=1 "$@"; }

tables=$(local_sql -c "SELECT count(*) FROM pg_tables WHERE schemaname='public'")
if [ "$tables" != 0 ] && [ "${1:-}" != --again ]; then
  echo "This VM's database already has data ($tables tables). To replace it with a fresh copy from Railway: migrate-db.sh --again"; exit 1
fi

say "Stopping Dev Resolve on this VM (if running) while copying"
dr stop app >/dev/null 2>&1 || true

say "Copying from Railway (read-only there)"
sudo mkdir -p "$BK" && sudo chmod 700 "$BK"
DUMP="$BK/railway-$(date -u +%Y%m%d-%H%M%S).dump"
echo "Railway Postgres: $(pgtool psql "$SRC" -tAc 'SHOW server_version')"
pgtool pg_dump --format=custom --no-owner --no-acl "$SRC" | sudo tee "$DUMP" >/dev/null
sudo chmod 600 "$DUMP"
echo "backup of the Railway data kept at $DUMP ($(sudo du -h "$DUMP" | cut -f1))"

if [ "$tables" != 0 ]; then
  say "Clearing the earlier copy"
  local_sql -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public AUTHORIZATION dev_resolve_owner; GRANT USAGE ON SCHEMA public TO dev_resolve_app;" >/dev/null
fi
say "Loading into this VM's database"
sudo cat "$DUMP" | dr exec -T postgres pg_restore --no-owner --no-acl -U dev_resolve_owner -d dev_resolve --exit-on-error
local_sql -c "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO dev_resolve_app;
              GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO dev_resolve_app;" >/dev/null

say "Checking every table has the same number of rows on both sides"
COUNT_SQL="SELECT string_agg(format('%s=%s', table_name, (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM public.%I', table_name), false, true, '')))[1]::text), ' ' ORDER BY table_name) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'"
a=$(pgtool psql "$SRC" -tAc "$COUNT_SQL"); b=$(local_sql -c "$COUNT_SQL")
if [ "$a" = "$b" ]; then echo "all match: $(echo "$b" | wc -w) tables"; echo "$b" | tr ' ' '\n' | sed 's/^/  /'
else
  echo "Counts differ (someone may have used Dev Resolve on Railway during the copy — run migrate-db.sh --again):"
  diff <(echo "$a" | tr ' ' '\n') <(echo "$b" | tr ' ' '\n') || true
  exit 1
fi

say "Building and starting Dev Resolve (first build takes ~5 min)"
dr up -d --build app caddy
DOMAIN=$(sudo sed -n 's/^DOMAIN=//p' "$ETC/compose.env")
for i in $(seq 1 60); do
  if curl -fsS "https://$DOMAIN/api/healthz" >/dev/null 2>&1; then break; fi; sleep 5
done
if curl -fsS "https://$DOMAIN/api/healthz"; then
  echo; sudo systemctl enable --now dev-resolve-update.timer >/dev/null
  say "Dev Resolve is running at https://$DOMAIN"
  echo "Next: in Vercel set BACKEND_URL=https://$DOMAIN and redeploy (README step 6)."
else
  echo "Not answering on https://$DOMAIN yet. Check:  dr logs --tail 80 app   and   dr logs --tail 40 caddy"
  echo "(Caddy needs ports 80 and 443 open in Oracle's Security List — README step 2.)"
  exit 1
fi
