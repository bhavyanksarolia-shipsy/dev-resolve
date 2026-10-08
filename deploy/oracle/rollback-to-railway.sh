#!/usr/bin/env bash
# Run on the VM if you decide to go back to Railway after switching: copies everything done on this VM since the move
# (investigations, RCAs, users, settings, sign-ins) back into Railway's database, so nothing is lost.
# Railway's current data is saved to a file first. Then switch the frontend back (README: "Go back to Railway").
# Only switching back for a few minutes and nothing important happened here? You can skip this and just do the Vercel step.
set -euo pipefail
ETC=/etc/dev-resolve
BK=/var/backups/dev-resolve
say() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
SRC=$(sudo sed -n 's/^RAILWAY_DATABASE_URL=//p' "$ETC/railway-db.env" 2>/dev/null || true)
[ -n "$SRC" ] || { echo "No Railway database address on this VM (send-env.sh puts it there)"; exit 1; }
pgtool() { sudo docker run --rm -i --network host postgres:17-alpine "$@"; }
local_sql() { /usr/local/bin/dr exec -T postgres psql -U postgres -d dev_resolve -tA -v ON_ERROR_STOP=1 "$@"; }

echo "This REPLACES the data in Railway's database with this VM's data, and stops Dev Resolve on this VM."
read -rp "Type  railway  to go ahead: " ok
[ "$ok" = railway ] || { echo "Nothing changed."; exit 1; }

say "Stopping Dev Resolve on this VM (no new changes while copying)"
/usr/local/bin/dr stop app

sudo mkdir -p "$BK" && sudo chmod 700 "$BK"
STAMP=$(date -u +%Y%m%d-%H%M%S)
say "Saving Railway's current data first (in case you need it)"
pgtool pg_dump --format=custom --no-owner --no-acl "$SRC" | sudo tee "$BK/railway-before-rollback-$STAMP.dump" >/dev/null
echo "saved: $BK/railway-before-rollback-$STAMP.dump"

say "Copying this VM's data into Railway"
/usr/local/bin/dr exec -T postgres pg_dump --format=custom --no-owner --no-acl -U postgres dev_resolve | sudo tee "$BK/vm-to-railway-$STAMP.dump" >/dev/null
sudo cat "$BK/vm-to-railway-$STAMP.dump" | pgtool pg_restore --clean --if-exists --no-owner --no-acl -d "$SRC"

say "Checking every table has the same number of rows on both sides"
COUNT_SQL="SELECT string_agg(format('%s=%s', table_name, (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM public.%I', table_name), false, true, '')))[1]::text), ' ' ORDER BY table_name) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'"
a=$(local_sql -c "$COUNT_SQL"); b=$(pgtool psql "$SRC" -tAc "$COUNT_SQL")
if [ "$a" = "$b" ]; then echo "all match: $(echo "$a" | wc -w) tables"; else diff <(echo "$a" | tr ' ' '\n') <(echo "$b" | tr ' ' '\n') || true; echo "Counts differ — check before switching"; exit 1; fi

say "Done. Now:"
cat <<'EOF2'
  1. Railway → dev-resolve service → Restart   (it reloads settings and sign-ins from the copied data)
  2. Vercel → Deployments → the last deployment from before the move → ⋯ → Instant Rollback
     (or set BACKEND_URL back to the Railway address and Redeploy)
  3. Everyone: Connector page → download the extension again (it points at Railway again)
  To come back to this VM later:  dr up -d app   then  migrate-db.sh --again
EOF2
