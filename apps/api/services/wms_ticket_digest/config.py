"""
Central configuration for the WMS ticket digest.

Everything that used to be hardcoded inline in the n8n Code nodes (API
tokens, valid stages, valid pods, account aliases, POC/Slack-mention
mapping) lives here or in the config/*.json files this module loads.
That's the fix for the "filter lists drift out of sync" and
"secrets pasted into node bodies" gaps found in the n8n version --
there is now exactly one place each of those lists is defined.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent
CONFIG_DIR = BASE_DIR / "config"

load_dotenv(BASE_DIR / ".env")


def _require_env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(
            f"Missing required environment variable: {name}. "
            f"Copy .env.example to .env and fill it in."
        )
    return value


def _load_json(filename: str):
    path = CONFIG_DIR / filename
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


# ---------- Secrets / connection info (from .env, never hardcoded) ----------

DEVREV_TOKEN = _require_env("DEVREV_TOKEN")
DEVREV_BASE_URL = os.environ.get("DEVREV_BASE_URL", "https://api.devrev.ai")

SLACK_BOT_TOKEN = _require_env("SLACK_BOT_TOKEN")
SLACK_CHANNEL_PROD = _require_env("SLACK_CHANNEL_PROD")
SLACK_CHANNEL_TEST = os.environ.get("SLACK_CHANNEL_TEST", SLACK_CHANNEL_PROD)
SLACK_OPS_ALERT_CHANNEL = os.environ.get("SLACK_OPS_ALERT_CHANNEL", "")

GOOGLE_SERVICE_ACCOUNT_FILE = os.environ.get("GOOGLE_SERVICE_ACCOUNT_FILE", "")
GOOGLE_SHEET_ID = os.environ.get("GOOGLE_SHEET_ID", "")
GOOGLE_SHEET_NAME = os.environ.get("GOOGLE_SHEET_NAME", "TICKETS_RAW")

STATE_DB_PATH = os.environ.get(
    "STATE_DB_PATH", str(BASE_DIR / "state" / "wms_digest.sqlite3")
)

# ---------- Domain config (single source of truth, editable without touching code) ----------

# Ported 1:1 from the DevRev query body + response_pretier's VALID_STAGES in
# the n8n workflow, with the "resolved" stage removed -- the API filter never
# requested it in the first place, so it was dead code there. If you *do*
# want resolved tickets tracked, add it here AND make sure fetch uses it too
# (this file is the only place it needs to change now).
_stages_cfg = _load_json("stages.json")
VALID_STAGES: list[str] = _stages_cfg["valid_stages"]
DEV_STAGES: set[str] = set(_stages_cfg["dev_stages"])  # stages that get issue-linkage checked

VALID_PODS: list[str] = ["WMS Inbound", "WMS Outbound", "WMS"]

TICKET_TYPE = "ticket"
TICKET_SUBTYPE = "Support"

# pod+stage -> list of Slack user IDs to @mention. Seeded from the n8n
# pod_format node. NOTE: individual-user mentions were the direct cause of
# the "departed employee still gets tagged" bug -- see ownership.py for the
# automated deactivated-user check that now guards every one of these.
POC_MAP: dict = _load_json("poc_map.json")

# raw DevRev account display-name -> canonical name. Seeded from the n8n
# account_format node's match_account dict. This list WILL go stale as
# customers are renamed or onboarded -- accounts.py falls back to fuzzy
# matching and flags anything it can't confidently resolve instead of
# silently creating a duplicate row, but this file should still be reviewed
# periodically.
ACCOUNT_ALIASES: dict = _load_json("accounts.json")

# Slack message length at which we split into a threaded follow-up post
# instead of sending one unbounded string (Slack's hard limit is ~40,000
# chars for chat.postMessage `text`, but staying well under it avoids any
# edge-case rejection and keeps messages readable).
SLACK_MESSAGE_CHUNK_LIMIT = int(os.environ.get("SLACK_MESSAGE_CHUNK_LIMIT", "3500"))

# Pagination page size for DevRev works.list / links.list calls.
DEVREV_PAGE_LIMIT = int(os.environ.get("DEVREV_PAGE_LIMIT", "100"))
