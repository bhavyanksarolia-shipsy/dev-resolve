#!/usr/bin/env bash
# Change a Dev Resolve UI login's password (default user: admin). Signs everyone out.
set -euo pipefail
cd "$(dirname "$0")/.."
USER_NAME="${1:-admin}"
read -r -s -p "New password for '${USER_NAME}': " P1; echo
read -r -s -p "Repeat it: " P2; echo
[ "${P1}" = "${P2}" ] || { echo "Passwords don't match — nothing changed."; exit 1; }
[ ${#P1} -ge 8 ] || { echo "Use at least 8 characters — nothing changed."; exit 1; }
case "${P1}" in *[,:]*) echo "Password can't contain ',' or ':' — nothing changed."; exit 1 ;; esac
NEW_USER="${USER_NAME}" NEW_PW="${P1}" python3 - <<'PY'
import os, re, secrets, pathlib
p = pathlib.Path(".env.local"); s = p.read_text()
u, pw = os.environ["NEW_USER"], os.environ["NEW_PW"]
m = re.search(r"^DEV_RESOLVE_USERS=(.*)$", s, re.M)
pairs = [x for x in (m.group(1).split(",") if m else []) if x and not x.startswith(u + ":")]
pairs.append(f"{u}:{pw}")
line = "DEV_RESOLVE_USERS=" + ",".join(pairs)
s = re.sub(r"^DEV_RESOLVE_USERS=.*$", lambda _: line, s, flags=re.M) if m else s + "\n" + line + "\n"
# New signing secret → every existing session (incl. anyone still logged in with the old password) is signed out.
s = re.sub(r"^DEV_RESOLVE_SESSION_SECRET=.*$", lambda _: "DEV_RESOLVE_SESSION_SECRET=" + secrets.token_hex(32), s, flags=re.M)
p.write_text(s)
PY
unset P1 P2
echo "Password for '${USER_NAME}' changed; everyone has been signed out."
echo "Takes effect immediately (the running app reloads .env.local) — share the new password with your colleague."
