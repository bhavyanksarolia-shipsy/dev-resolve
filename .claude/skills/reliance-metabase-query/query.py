#!/usr/bin/env python3
"""Read-only Metabase query CLI for Reliance debugging — multiple Reliance
products/Metabase instances, configured dynamically from projects.json in
Dev Resolve's config/ folder  and selected via --project. Adding a new project
is pure data entry (edit projects.json + config.env) — no code change here.
See README.md in that folder for the exact steps.

Config/session are stored under Dev Resolve's config/ folder  (one folder,
shared with the reliance-opensearch-logs MCP server) — never inside this
project directory, never committed anywhere.

Commands:
  query.py login [--project P]                            interactive username/password login
  query.py set-credentials [--project P]                  store username/password for auto-refresh (run yourself, never via chat)
  query.py set-session <token> [--project P]               store an existing metabase.SESSION cookie value
  query.py set-base-url <url> [--project P]                override a project's Metabase base URL (writes to projects.json)
  query.py whoami [--project P]                            verify the stored session is valid
  query.py databases [--project P]                         list databases visible to this account
  query.py projects                                         list all configured --project values and their databases
  query.py tables --database ID [--project P]              list tables in a database
  query.py sql "SELECT ..." [--database ID] [--project P] [--format table|json|csv] [--out FILE] [--timeout SEC]

--project defaults to "wms". Run `query.py projects` for the live, current
list of projects and databases — don't rely on a hardcoded list from memory,
since projects.json can gain new projects at any time without this script
changing.
"""
import argparse
import csv
import getpass
import io
import json
import os
import re
import socket
import sys
import time
import urllib.error
import urllib.request

TOOL_DIR = os.environ.get("DEV_RESOLVE_CONFIG_DIR") or os.path.abspath(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "config"))
CONFIG_ENV_FILE = os.path.join(TOOL_DIR, "config.env")
PROJECTS_FILE = os.path.join(TOOL_DIR, "projects.json")
RATE_FILE = os.path.join(TOOL_DIR, "metabase_ratelimit.json")
DEFAULT_PROJECT = "wms"


def _load_projects_file() -> dict:
    if not os.path.exists(PROJECTS_FILE):
        return {}
    with open(PROJECTS_FILE) as f:
        return json.load(f)


def _build_projects() -> dict:
    """One entry per project that declares a "metabase" section in
    projects.json. Credentials AND the session token all live in config.env,
    referenced here only by key name (never a value) — session_token_key
    names the config.env key that holds this project's live session token."""
    out = {}
    for name, proj in _load_projects_file().items():
        if not isinstance(proj, dict):
            continue  # e.g. the top-level "accounts" list — not a project entry
        mb = proj.get("metabase")
        if not mb:
            continue
        out[name] = {
            "label": proj.get("label", name),
            "base_url_key": mb.get("base_url_env"),
            "username_key": mb.get("username_env"),
            "password_key": mb.get("password_env"),
            "session_token_key": mb.get("session_token_env", f"RELIANCE_{name.upper()}_METABASE_SESSION_TOKEN"),
            "default_database": mb.get("default_database"),
            "databases": mb.get("databases", {}),
        }
    return out


PROJECTS = _build_projects()

WRITE_KEYWORDS = re.compile(
    r"\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|GRANT|REVOKE|"
    r"EXEC|EXECUTE|CALL|MERGE|COPY|VACUUM|REINDEX)\b",
    re.IGNORECASE,
)

BURST_LIMIT, BURST_WINDOW = 10, 60          # 10 requests / 60s
SUSTAINED_LIMIT, SUSTAINED_WINDOW = 120, 3600  # 120 requests / hour


def _project_cfg(project: str) -> dict:
    if project not in PROJECTS:
        print(f"Unknown --project {project!r}. Must be one of: {', '.join(PROJECTS)}.", file=sys.stderr)
        sys.exit(1)
    return PROJECTS[project]


def _ensure_tool_dir():
    os.makedirs(TOOL_DIR, exist_ok=True, mode=0o700)


def _load_json(path, default):
    if not os.path.exists(path):
        return default
    with open(path) as f:
        return json.load(f)


def _save_json(path, data, mode=0o600):
    _ensure_tool_dir()
    with open(path, "w") as f:
        json.dump(data, f)
    os.chmod(path, mode)


def _load_config_env():
    if not os.path.exists(CONFIG_ENV_FILE):
        return {}
    out = {}
    with open(CONFIG_ENV_FILE) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            out[k.strip()] = v.strip()
    return out


def _write_config_env(updates):
    """Merge `updates` into the shared config.env, preserving other keys
    (e.g. RELIANCE_OS_* used by the reliance-opensearch-logs MCP server, and
    every other project's own keys)."""
    _ensure_tool_dir()
    cfg = _load_config_env()
    cfg.update(updates)
    with open(CONFIG_ENV_FILE, "w") as f:
        for k, v in cfg.items():
            f.write(f"{k}={v}\n")
    os.chmod(CONFIG_ENV_FILE, 0o600)


def get_base_url(project: str):
    return _load_config_env().get(_project_cfg(project)["base_url_key"])


def _get_metabase_credentials(project: str):
    cfg = _project_cfg(project)
    env = _load_config_env()
    return env.get(cfg["username_key"]), env.get(cfg["password_key"])


def _get_stored_session_token(project: str):
    return _load_config_env().get(_project_cfg(project)["session_token_key"])


def _store_session_token(project: str, token: str):
    _write_config_env({_project_cfg(project)["session_token_key"]: token})


def _auto_login(project: str):
    """Try to obtain a fresh session using stored credentials for this
    project. Returns the new token on success, None if no credentials are
    stored or login fails (never raises/exits — caller decides what to do next)."""
    username, password = _get_metabase_credentials(project)
    if not username or not password:
        return None
    status, body = _request(project, "POST", "/api/session", body={"username": username, "password": password})
    if status != 200:
        return None
    token = body["id"]
    _store_session_token(project, token)
    return token


def get_session_token(project: str, auto_refresh=True):
    token = _get_stored_session_token(project)
    if not token and auto_refresh:
        token = _auto_login(project)
    if not token:
        print(
            f"No session token stored for --project {project}. Run `query.py login --project {project}`, "
            f"`query.py set-session <cookie value> --project {project}`, or "
            f"`query.py set-credentials --project {project}` (for auto-refresh) first.",
            file=sys.stderr,
        )
        sys.exit(2)
    return token


def _mask(token):
    return f"...{token[-4:]}" if token and len(token) > 4 else "****"


def _check_rate_limit():
    now = time.time()
    events = [t for t in _load_json(RATE_FILE, []) if now - t < SUSTAINED_WINDOW]
    burst = [t for t in events if now - t < BURST_WINDOW]
    if len(burst) >= BURST_LIMIT:
        wait = BURST_WINDOW - (now - burst[0])
        print(f"Rate limited: {len(burst)}/{BURST_LIMIT} requests in {BURST_WINDOW}s. Wait ~{wait:.0f}s.", file=sys.stderr)
        sys.exit(3)
    if len(events) >= SUSTAINED_LIMIT:
        wait = SUSTAINED_WINDOW - (now - events[0])
        print(f"Rate limited: {len(events)}/{SUSTAINED_LIMIT} requests this hour. Wait ~{wait / 60:.0f}m.", file=sys.stderr)
        sys.exit(3)
    events.append(now)
    _save_json(RATE_FILE, events, mode=0o600)


def _request(project, method, path, token=None, body=None, timeout=30):
    url = get_base_url(project).rstrip("/") + path
    headers = {"Content-Type": "application/json"}
    if token:
        headers["X-Metabase-Session"] = token
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        raw = e.read().decode(errors="replace")
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            parsed = {"raw": raw}
        return e.code, parsed
    except (socket.timeout, TimeoutError):
        print(
            f"Request to {path} timed out after {timeout}s. "
            "Try adding filters/a narrower date range, or pass --timeout to allow more time.",
            file=sys.stderr,
        )
        sys.exit(4)
    except urllib.error.URLError as e:
        base = get_base_url(project)
        hint = ""
        if ".ril.com" in base:
            hint = (
                " VPN_REQUIRED: this is almost always the Cisco AnyConnect 'ril' "
                "VPN (tvpn.ril.com) not being connected — connect it and retry "
                "this exact command, don't report this as a data-not-found result."
            )
        print(f"Connection error reaching {base}: {e.reason}.{hint}", file=sys.stderr)
        sys.exit(4)


def _handle_common_errors(project, status, body, database_id=None):
    if status == 401:
        _fail_no_session(project)
    if status == 404:
        hint = f" (database {database_id})" if database_id else ""
        print(f"404 Not Found{hint} — wrong database/table/card ID. Run `query.py databases --project {project}` to list valid IDs.", file=sys.stderr)
        sys.exit(1)
    if status >= 400:
        print(f"Error ({status}): {body}", file=sys.stderr)
        sys.exit(1)


def _fail_no_session(project):
    print(
        f"AUTH_FAILED: 401 Unauthorized — session expired and could not auto-refresh for "
        f"--project {project}. This needs the USER to run one of these themselves (never "
        f"paste a password into chat): `query.py login --project {project}`, "
        f"`query.py set-session <cookie value> --project {project}`, or "
        f"`query.py set-credentials --project {project}`. Once they confirm it's done, retry "
        f"this exact command — don't report this as a data-not-found result.",
        file=sys.stderr,
    )
    sys.exit(1)


def _authed_request(project, method, path, body=None, timeout=30):
    """GET/POST with the stored session for this project; on a 401, tries one
    silent credential-based re-login (see `set-credentials`) and retries once
    before giving up. Returns (status, response_body, token_used)."""
    token = get_session_token(project)
    status, resp = _request(project, method, path, token=token, body=body, timeout=timeout)
    if status == 401:
        new_token = _auto_login(project)
        if new_token:
            token = new_token
            status, resp = _request(project, method, path, token=token, body=body, timeout=timeout)
    return status, resp, token


def cmd_login(args):
    project = args.project
    username = input(f"Metabase username/email ({project}): ").strip()
    password = getpass.getpass("Metabase password: ")
    status, body = _request(project, "POST", "/api/session", body={"username": username, "password": password})
    password = None  # never retained
    if status != 200:
        print(f"Login failed ({status}): {body.get('message') or body.get('errors') or body}", file=sys.stderr)
        sys.exit(1)
    token = body["id"]
    _store_session_token(project, token)
    print(f"Login OK ({project}). Session stored ({_mask(token)}). Metabase sessions expire after ~14 days.")


def cmd_set_credentials(args):
    project = args.project
    print("Stores username/password for automatic session refresh — run this yourself,")
    print("never paste your Metabase password into a chat with Claude.")
    username = input(f"Metabase username/email ({project}): ").strip()
    password = getpass.getpass("Metabase password: ")
    status, body = _request(project, "POST", "/api/session", body={"username": username, "password": password})
    if status != 200:
        password = None
        print(f"Login failed ({status}): {body.get('message') or body.get('errors') or body}", file=sys.stderr)
        sys.exit(1)
    token = body["id"]
    cfg = _project_cfg(project)
    _write_config_env({
        cfg["username_key"]: username,
        cfg["password_key"]: password,
        cfg["session_token_key"]: token,
    })
    password = None  # never retained beyond the file write above
    print(
        f"Credentials stored in {CONFIG_ENV_FILE} (mode 600) for --project {project} and session refreshed "
        f"({_mask(token)}). Future 401s auto-refresh without running `login` again."
    )


def cmd_set_session(args):
    project = args.project
    token = args.token.strip()
    _store_session_token(project, token)
    print(f"Session token stored ({_mask(token)}) for --project {project}.")


def cmd_set_base_url(args):
    project = args.project
    cfg = _project_cfg(project)
    _write_config_env({cfg["base_url_key"]: args.url.strip()})
    print(f"Base URL for --project {project} set to {args.url.strip()} in {CONFIG_ENV_FILE}")


def cmd_projects(_args):
    if not PROJECTS:
        print("No projects configured — check projects.json in Dev Resolve's config/ folder ")
        return
    env = _load_config_env()
    for name, cfg in PROJECTS.items():
        default_marker = " (default)" if name == DEFAULT_PROJECT else ""
        print(f"{name}{default_marker} — {cfg['label']}")
        print(f"  base_url: {env.get(cfg['base_url_key'], '(not set in config.env)')}")
        has_creds = bool(cfg["username_key"]) and bool(_load_config_env().get(cfg["username_key"] or ""))
        print(f"  credentials stored: {'yes' if has_creds else 'no — run set-credentials --project ' + name}")
        for db_id, db_label in cfg["databases"].items():
            print(f"  --database {db_id}: {db_label}")


def cmd_accounts(_args):
    """The user-facing account list (Reliance VF / QC / JioMart 3P / ...) —
    for the conversation-start "select a project" prompt. Read live from
    projects.json's top-level "accounts" array; not hardcoded here, so a new
    account shows up automatically once added there."""
    accounts = _load_projects_file().get("accounts", [])
    if not accounts:
        print("No accounts configured — add an \"accounts\" array to projects.json")
        return
    for acc in accounts:
        print(acc["name"])
        print(f"  opensearch log_type: {acc.get('opensearch_log_type', '-')}")
        print(f"  metabase: --project {acc.get('metabase_project', '-')} --database {acc.get('metabase_database', '-')}")


def cmd_whoami(args):
    project = args.project
    status, body, token = _authed_request(project, "GET", "/api/user/current")
    if status == 401:
        _fail_no_session(project)
    if status != 200:
        print(f"Unexpected error ({status}): {body}", file=sys.stderr)
        sys.exit(1)
    print(f"[{project}] Logged in as {body.get('email')} (session {_mask(token)})")


def cmd_databases(args):
    project = args.project
    _check_rate_limit()
    status, body, _token = _authed_request(project, "GET", "/api/database")
    _handle_common_errors(project, status, body)
    dbs = body.get("data", body) if isinstance(body, dict) else body
    for db in dbs:
        print(f"{db['id']:>4}  {db['name']}")


def cmd_tables(args):
    project = args.project
    database = args.database if args.database is not None else _project_cfg(project)["default_database"]
    _check_rate_limit()
    status, body, _token = _authed_request(project, "GET", f"/api/database/{database}/metadata")
    _handle_common_errors(project, status, body, database_id=database)
    for t in body.get("tables", []):
        print(f"{t['id']:>6}  {t['name']}")


def cmd_sql(args):
    project = args.project
    query = args.query.strip()
    if not re.match(r"^\s*(WITH|SELECT)\b", query, re.IGNORECASE):
        print("Refusing: query must start with SELECT or WITH. This tool is read-only.", file=sys.stderr)
        sys.exit(5)
    if WRITE_KEYWORDS.search(query):
        print("Refusing: query contains a write/DDL keyword. This tool is read-only.", file=sys.stderr)
        sys.exit(5)

    database = args.database if args.database is not None else _project_cfg(project)["default_database"]

    _check_rate_limit()
    body = {"database": database, "type": "native", "native": {"query": query}}
    status, resp, _token = _authed_request(project, "POST", "/api/dataset", body=body, timeout=args.timeout)

    if status == 401:
        _fail_no_session(project)
    if status == 404:
        print(f"404 Not Found — check --database {database} is valid (`query.py databases --project {project}`).", file=sys.stderr)
        sys.exit(1)

    err = None
    if isinstance(resp, dict):
        data_field = resp.get("data") or {}
        err = resp.get("error") or data_field.get("error") or (data_field.get("native_form") or {}).get("error")
    if err or status >= 400:
        print(f"Query error: {err or resp}", file=sys.stderr)
        sys.exit(1)

    data = resp.get("data", {})
    cols = [c["display_name"] if isinstance(c, dict) else c for c in data.get("cols", [])]
    rows = data.get("rows", [])

    if args.format == "json":
        _emit(json.dumps([dict(zip(cols, row)) for row in rows], indent=2, default=str), args.out)
    elif args.format == "csv":
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(cols)
        w.writerows(rows)
        _emit(buf.getvalue(), args.out)
    else:
        _print_table(cols, rows)
        print(f"\n{len(rows)} row(s)")


def _emit(text, out_path):
    if out_path:
        with open(out_path, "w") as f:
            f.write(text)
        print(f"Written to {out_path}")
    else:
        print(text)


def _print_table(cols, rows):
    widths = [len(str(c)) for c in cols]
    str_rows = [[str(v) for v in row] for row in rows]
    for row in str_rows:
        for i, v in enumerate(row):
            widths[i] = max(widths[i], len(v))

    def fmt_row(vals):
        return "  ".join(v.ljust(widths[i]) for i, v in enumerate(vals))

    print(fmt_row([str(c) for c in cols]))
    print("  ".join("-" * w for w in widths))
    for row in str_rows:
        print(fmt_row(row))


def main():
    parser = argparse.ArgumentParser(description="Read-only Metabase query CLI (Reliance VF/QC/JioMart 3P)")
    sub = parser.add_subparsers(dest="command", required=True)

    def add_project_arg(p):
        p.add_argument("--project", choices=list(PROJECTS), default=DEFAULT_PROJECT)

    add_project_arg(sub.add_parser("login"))
    add_project_arg(sub.add_parser("set-credentials"))
    p = sub.add_parser("set-session")
    p.add_argument("token")
    add_project_arg(p)
    p = sub.add_parser("set-base-url")
    p.add_argument("url")
    add_project_arg(p)
    add_project_arg(sub.add_parser("whoami"))
    add_project_arg(sub.add_parser("databases"))
    sub.add_parser("projects")
    sub.add_parser("accounts")
    p = sub.add_parser("tables")
    p.add_argument("--database", type=int, default=None)
    add_project_arg(p)
    p = sub.add_parser("sql")
    p.add_argument("query")
    p.add_argument("--database", type=int, default=None)
    p.add_argument("--format", choices=["table", "json", "csv"], default="table")
    p.add_argument("--out", default=None)
    p.add_argument("--timeout", type=int, default=30)
    add_project_arg(p)

    args = parser.parse_args()
    handlers = {
        "login": cmd_login,
        "set-credentials": cmd_set_credentials,
        "set-session": cmd_set_session,
        "set-base-url": cmd_set_base_url,
        "whoami": cmd_whoami,
        "databases": cmd_databases,
        "projects": cmd_projects,
        "accounts": cmd_accounts,
        "tables": cmd_tables,
        "sql": cmd_sql,
    }
    handlers[args.command](args)


if __name__ == "__main__":
    main()
