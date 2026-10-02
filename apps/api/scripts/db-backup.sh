#!/usr/bin/env bash
# Nightly Postgres backup (custom format, compressed) with retention. For self-hosted Postgres —
# managed Postgres (RDS / Cloud SQL) has its own automated backups + point-in-time restore; turn those on instead.
#   BACKUP_DIR=/data/backups KEEP_DAYS=14 scripts/db-backup.sh        (cron: 30 2 * * *)
# Restore: pg_restore --clean --if-exists -d "$DATABASE_URL" <file>.dump
set -euo pipefail
: "${DATABASE_URL:?DATABASE_URL is not set}"
DIR="${BACKUP_DIR:-./backups}"; KEEP="${KEEP_DAYS:-14}"
mkdir -p "$DIR"; chmod 700 "$DIR"
OUT="$DIR/dev_resolve-$(date -u +%Y%m%d-%H%M%S).dump"
pg_dump --format=custom --no-owner --dbname="$DATABASE_URL" --file="$OUT.part"
mv "$OUT.part" "$OUT"; chmod 600 "$OUT"
find "$DIR" -name 'dev_resolve-*.dump' -mtime +"$KEEP" -delete
echo "backup: $OUT ($(du -h "$OUT" | cut -f1))"
