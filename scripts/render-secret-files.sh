#!/usr/bin/env bash
# Prepare the private files to paste into Render → your service → Environment → Secret Files.
# Writes them to a private folder OUTSIDE the repo (never commit them). Knowledge is packed as one text file.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="${1:-$HOME/dev-resolve-render-secrets}"
mkdir -p "$OUT"; chmod 700 "$OUT"
cp config/projects.json config/config.env "$OUT/"
tar -czf - --exclude='_template' --exclude='_shared' --exclude='README.md' -C knowledge . | base64 > "$OUT/knowledge.tgz.b64"
chmod 600 "$OUT"/*
echo "Secret files ready in $OUT — in Render add three Secret Files with exactly these names and contents:"
for f in projects.json config.env knowledge.tgz.b64; do echo "  $f  ($(du -h "$OUT/$f" | cut -f1))"; done
echo "Delete the folder when done:  rm -rf \"$OUT\""
