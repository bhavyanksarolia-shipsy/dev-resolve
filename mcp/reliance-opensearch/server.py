#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = ["mcp[cli]>=1.2.0,<2", "requests", "urllib3"]
# ///
"""
Read-only MCP server for Reliance OpenSearch clusters — dynamically
configured from projects.json in this same folder. Adding a new Reliance
product/cluster is pure data entry (edit projects.json + config.env), no
code change needed — see README.md in this folder for the exact steps.

Why this exists: these clusters' raw REST API (`_search`, `_cluster/health`)
rejects normal accounts (`security_exception`, no backend_roles mapped).
OpenSearch Dashboards' own Discover UI works anyway because it queries
through Dashboards' internal search service instead of the raw REST API.
This server replicates that exact call. It only ever does read/search
operations — no index, delete, or cluster-admin calls are implemented.

Structure (index patterns, which env var names hold what) lives in
./projects.json. Actual values — URLs, usernames, passwords — come from
./config.env in this same folder (or the environment), referenced by name
only from projects.json. Never hardcoded here.
"""
import json
import os
from datetime import datetime, timezone

import requests
import urllib3
from mcp.server.fastmcp import FastMCP

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

TOOL_DIR = os.environ.get("DEV_RESOLVE_CONFIG_DIR") or os.path.abspath(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "config"))
CONFIG_FILE = os.path.join(TOOL_DIR, "config.env")
PROJECTS_FILE = os.path.join(TOOL_DIR, "projects.json")


def _load_config_file() -> dict:
    if not os.path.exists(CONFIG_FILE):
        return {}
    out = {}
    with open(CONFIG_FILE) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            out[k.strip()] = v.strip()
    return out


def _load_projects() -> dict:
    if not os.path.exists(PROJECTS_FILE):
        return {}
    with open(PROJECTS_FILE) as f:
        return json.load(f)


_file_cfg = _load_config_file()
_projects = _load_projects()


def _cfg(key: str | None) -> str | None:
    if not key:
        return None
    return os.environ.get(key) or _file_cfg.get(key)


# Built from projects.json: one CLUSTERS entry per project with an
# "opensearch" section, one LOG_INDEXES entry per log_type any project
# declares. A project's opensearch.username_env/password_env may be null
# (e.g. a cluster whose internal search endpoint needs no auth at all) —
# then that cluster's requests go out with no credentials.
CLUSTERS = {}
LOG_INDEXES = {}
for _proj_name, _proj in _projects.items():
    if not isinstance(_proj, dict):
        continue  # e.g. the top-level "accounts" list — not a project entry
    _os_cfg = _proj.get("opensearch")
    if not _os_cfg:
        continue
    CLUSTERS[_proj_name] = {
        "url": _cfg(_os_cfg.get("url_env")),
        "username": _cfg(_os_cfg.get("username_env")),
        "password": _cfg(_os_cfg.get("password_env")),
    }
    for _log_type, _index in _os_cfg.get("log_types", {}).items():
        LOG_INDEXES[_log_type] = {"cluster": _proj_name, "index": _index}

DEFAULT_LOG_TYPE = "reliance_app" if "reliance_app" in LOG_INDEXES else (next(iter(LOG_INDEXES), None))

# Hard caps so one noisy log line (e.g. a full payload dump) can't flood the caller's context.
MAX_MESSAGE_CHARS = int(os.environ.get("OS_MAX_MESSAGE_CHARS", "2000"))
MAX_OUTPUT_CHARS = int(os.environ.get("OS_MAX_OUTPUT_CHARS", "40000"))

mcp = FastMCP("reliance-opensearch-logs")


def _search(query: str, size: int, hours_back: int, warehouse: str | None,
            level: str | None, request_id: str | None, log_type: str,
            field_filters: dict | None = None) -> dict:
    if log_type not in LOG_INDEXES:
        raise ValueError(f"Unknown log_type {log_type!r}. Must be one of: {', '.join(LOG_INDEXES)}.")
    entry = LOG_INDEXES[log_type]
    cluster = CLUSTERS[entry["cluster"]]
    index = entry["index"]

    os_url = cluster["url"]
    username = cluster["username"]
    password = cluster["password"]
    if not os_url:
        raise RuntimeError(f"OpenSearch URL for cluster {entry['cluster']!r} is not set in config.env.")
    # Auth is per-cluster, not required everywhere: vf-wms-os.ril.com (cluster
    # "wms") needs Basic Auth, but shipsy-wms-dashboard.ril.com (cluster
    # "jiomart_3p") answers this internal endpoint with no credentials at all
    # (confirmed live 2026-09-11) — so only require creds if the cluster
    # config actually names them.
    auth = (username, password) if username and password else None

    must = []
    if query:
        must.append({"match_phrase": {"message": query}})
    # match_phrase, not term: these fields are analyzed text in the QC/VF
    # indices, so a term query on the raw value ("U738", a hyphenated UUID)
    # silently matches nothing. match_phrase also works on keyword-mapped fields.
    if warehouse:
        must.append({"match_phrase": {"warehouse": warehouse}})
    if level:
        must.append({"match_phrase": {"level": level}})
    if request_id:
        must.append({"match_phrase": {"request_id": request_id}})
    # Audit-log fields (username, request_path, request body, ...). Same
    # match_phrase reasoning as above; status_code is numeric, so exact term.
    for field, value in (field_filters or {}).items():
        if field == "status_code":
            must.append({"term": {field: value}})
        else:
            must.append({"match_phrase": {field: value}})

    body = {
        "params": {
            "index": index,
            "body": {
                "size": max(1, min(size, 200)),
                "sort": [{"timestamp": {"order": "desc"}}],
                "query": {
                    "bool": {
                        "must": must if must else [{"match_all": {}}],
                        "filter": [
                            {
                                "range": {
                                    "timestamp": {
                                        "gte": f"now-{max(1, hours_back)}h",
                                        "lte": "now",
                                    }
                                }
                            }
                        ],
                    }
                },
            },
            "preference": int(datetime.now(timezone.utc).timestamp()),
        }
    }

    resp = requests.post(
        os_url,
        auth=auth,
        json=body,
        headers={"osd-xsrf": "osd-fetch", "osd-version": "2.19.3"},
        verify=False,
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()


@mcp.tool()
def list_log_types() -> str:
    """List every currently configured log_type (from projects.json), which
    cluster/project it belongs to, and whether that cluster's credentials are
    set. Call this if you're unsure what log_type values exist right now —
    projects.json can gain new ones at any time without this server's code
    changing, so don't rely on a hardcoded list from memory."""
    if not LOG_INDEXES:
        return "No log_types configured — check projects.json in Dev Resolve's config/ folder "
    lines = []
    for lt, entry in sorted(LOG_INDEXES.items()):
        cluster = CLUSTERS[entry["cluster"]]
        if not cluster["url"]:
            auth = "NO URL CONFIGURED"
        elif cluster["username"] and cluster["password"]:
            auth = "auth: username/password set"
        elif not cluster.get("username") and not cluster.get("password"):
            auth = "auth: none required for this cluster"
        else:
            auth = "auth: PARTIALLY configured — missing username or password"
        default_marker = " (default)" if lt == DEFAULT_LOG_TYPE else ""
        lines.append(f"{lt}{default_marker} — project={entry['cluster']}, index={entry['index']!r}, {auth}")
    return "\n".join(lines)


@mcp.tool()
def list_accounts() -> str:
    """List the user-facing accounts (e.g. "Reliance VF", "QC", "JioMart
    3P") for the conversation-start account-selection prompt. Read live from
    projects.json's top-level "accounts" array — a new account shows up here
    automatically once added there, no code change needed. Use this to build
    the options for an AskUserQuestion "select the project" prompt rather
    than hardcoding a list."""
    accounts = _projects.get("accounts", [])
    if not accounts:
        return "No accounts configured — add an \"accounts\" array to projects.json"
    lines = []
    for acc in accounts:
        lines.append(
            f"{acc['name']} — log_type={acc.get('opensearch_log_type', '-')}, "
            f"metabase: --project {acc.get('metabase_project', '-')} "
            f"--database {acc.get('metabase_database', '-')}"
        )
    return "\n".join(lines)


@mcp.tool()
def search_logs(
    query: str = "",
    size: int = 20,
    hours_back: int = 24,
    warehouse: str = "",
    level: str = "",
    request_id: str = "",
    log_type: str = DEFAULT_LOG_TYPE,
    username: str = "",
    request_path: str = "",
    request_method: str = "",
    status_code: int = 0,
    request_contains: str = "",
    response_contains: str = "",
) -> str:
    """Search Reliance OpenSearch logs (read-only), across multiple Reliance
    products/clusters, configured dynamically from projects.json. Pick
    log_type explicitly once you know which product/tenant the incident
    belongs to — don't rely on the default across products. If you're unsure
    what log_type values currently exist (new ones can be added to
    projects.json at any time), call list_log_types first instead of
    guessing from a possibly-stale list.

    Args:
        query: text to search for in the log 'message' field (phrase match). Leave empty to match all.
        size: max number of results to return (default 20, max 200).
        hours_back: how far back to search, in hours (default 24).
        warehouse: optional exact warehouse code filter (e.g. "TK1Z").
        level: optional exact log level filter (e.g. "ERROR", "INFO").
        request_id: optional exact request_id filter to pull a full trace for one request.
        username: optional user filter (audit logs, e.g. "PPRR01066710").
        request_path: optional audit transaction name — the Django route NAME,
            not the URL (e.g. "Tasks Creation" for PUT /api/v1/lms/tasks/create/).
        request_method: optional audit HTTP method filter (e.g. "PUT").
        status_code: optional audit HTTP status filter (e.g. 400); 0 = any.
        request_contains: optional phrase to find in the audit request body,
            e.g. 'type picklist' vs 'type cyclecount' to split task requests.
        response_contains: optional phrase to find in the audit response body
            (e.g. "No Task Available").
        log_type: which index to search — see list_log_types for the current
            full list. As of this server's last restart it includes at least:
            "reliance_app" (default): Reliance VF app logs
            "reliance_audit": Reliance VF audit logs
            "reliance_link": Reliance VF SAP/ERP integration middleware logs
            "qc_app": QC (Quick Commerce/JioMart darkstore) app logs
            "qc_audit": QC audit logs
            "qc_api": QC API/integration logs
            "jiomart_3p_app": JioMart 3P app logs
            "jiomart_3p_audit": JioMart 3P audit logs
            "jiomart_3p_link": JioMart 3P integration/link logs
    """
    try:
        field_filters = {
            k: v for k, v in {
                "username": username,
                "request_path": request_path,
                "request_method": request_method,
                "status_code": status_code,
                "request": request_contains,
                "response": response_contains,
            }.items() if v
        }
        data = _search(query, size, hours_back, warehouse or None, level or None, request_id or None, log_type,
                       field_filters)
    except requests.exceptions.ConnectionError as e:
        return (
            "VPN_REQUIRED: could not reach the OpenSearch host for this log_type. "
            "This almost always means the Cisco AnyConnect 'ril' VPN (tvpn.ril.com) "
            "is not connected. Connect it and retry this exact search — do not "
            f"report this as a data-not-found result. Raw error: {e}"
        )
    except requests.HTTPError as e:
        if e.response.status_code in (401, 403):
            return (
                f"AUTH_FAILED: HTTP {e.response.status_code} for this log_type's cluster — "
                "stored credentials are missing or invalid in Dev Resolve's config/ folder config.env. "
                "Tell the user which cluster/keys need fixing; don't guess or retry blindly."
            )
        return f"Search failed: HTTP {e.response.status_code} — {e.response.text[:500]}"
    except (ValueError, RuntimeError) as e:
        return f"Search failed: {e}"
    except Exception as e:
        return f"Search failed: {e}"

    index_name = LOG_INDEXES[log_type]["index"]
    hits = data.get("rawResponse", {}).get("hits", {})
    total = hits.get("total", 0)
    docs = hits.get("hits", [])
    if not docs:
        return f"No matching log entries in {index_name!r} (total matched: {total})."

    lines = [f"{total} total matches in {index_name!r}, showing {len(docs)}:\n"]
    for d in docs:
        src = d.get("_source", {})
        if src.get("request_path") and not src.get("message"):
            lines.append(_format_audit_doc(src))
            continue
        if not src.get("message"):
            # Integration (Liink) docs carry their payload in other fields — show them instead of an empty line.
            extra = {k: v for k, v in src.items() if k not in ("timestamp", "level", "warehouse", "request_id") and v not in (None, "", [], {})}
            body = json.dumps(extra, default=str, separators=(",", ":"))
        else:
            body = str(src.get("message", ""))
        if len(body) > MAX_MESSAGE_CHARS:
            body = body[:MAX_MESSAGE_CHARS] + f"…[+{len(body) - MAX_MESSAGE_CHARS} chars]"
        lines.append(
            f"[{src.get('timestamp')}] {src.get('level', '?')} "
            f"wh={src.get('warehouse', '-')} req={src.get('request_id', '-')} {body}"
        )
    out = "\n".join(lines)
    if len(out) > MAX_OUTPUT_CHARS:
        out = out[:MAX_OUTPUT_CHARS] + (
            f"\n…[output truncated at {MAX_OUTPUT_CHARS} chars — narrow with request_id/warehouse/level or a smaller size]"
        )
    return out


def _format_audit_doc(src: dict) -> str:
    """Audit docs have no 'message' — show who/what/result instead, with the
    request BODY/GET/POST params (headers dropped) and the response, truncated."""
    params = src.get("request", "")
    try:
        req = json.loads(params)
        params = json.dumps({k: v for k, v in req.items() if k != "HEADERS" and v}, separators=(",", ":"))
    except (TypeError, ValueError):
        pass
    resp = " ".join(str(src.get("response", "")).split())
    return (
        f"[{src.get('timestamp')}] AUDIT wh={src.get('warehouse', '-')} req={src.get('request_id', '-')} "
        f"user={src.get('username', '-')} {src.get('request_method', '?')} "
        f"'{src.get('request_path', '')}' status={src.get('status_code', '?')} "
        f"request={str(params)[:600]} response={resp[:300]}"
    )


if __name__ == "__main__":
    mcp.run()
