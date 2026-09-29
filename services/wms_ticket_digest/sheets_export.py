"""
Google Sheets export lane.

In the n8n workflow this branch (HTTP Request2 -> Code -> Code1 -> Code2 ->
Google Sheets) had no trigger attached to it at all, so it never ran in
production, and even if it had, its dedup logic compared against a second
node input that nothing ever supplied -- so every run would have
re-appended every matching ticket. Rebuilt here as an actually-runnable,
actually-deduplicated branch:

  * ticket normalization + SLA/issue-category enrichment ported from the
    n8n Code / Code1 nodes (same field names, same logic)
  * dedup is now backed by state_db's local SQLite table instead of an
    unwired "read the sheet back" pattern
  * appends via the Sheets API directly -- we don't rely on Sheets'
    'append or update' row-matching (that's what needed a "Column to match
    on" the original node never had configured), the local DB is what
    guarantees a ticket+day only gets written once
"""

from __future__ import annotations

from datetime import datetime, timezone

from google.oauth2 import service_account
from googleapiclient.discovery import build

import config
import state_db

SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]

SHEET_HEADERS = [
    "Date", "Ticket ID", "Pod", "Stage", "Priority", "Account", "Assignee",
    "Issue Summary", "Affected Parts", "SLA Status", "SLA Due At",
    "SLA Breach (mins)", "Created At", "Last Updated", "Turn Around(Days)",
]


def _fmt_dt(value: str | None) -> str:
    """Force text formatting so Sheets doesn't silently reinterpret dates,
    same intent as the n8n Code2 node's leading-quote trick."""
    if not value:
        return ""
    dt = value
    if isinstance(value, str):
        try:
            dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return value
    return "'" + dt.strftime("%Y-%m-%d %H:%M")


def normalize_ticket(t: dict) -> dict:
    """Port of the n8n `Code` node."""
    cf = t.get("custom_fields", {}) or {}
    owned_by = t.get("owned_by") or []
    return {
        "ticket_id": t.get("display_id"),
        "title": t.get("title"),
        "body": t.get("body"),
        "pod": cf.get("tnt__pod"),
        "stage": (t.get("stage") or {}).get("name"),
        "priority": t.get("severity"),
        "account": (t.get("account") or {}).get("display_name"),
        "assignee_name": owned_by[0].get("full_name") if owned_by else None,
        "assignee_email": owned_by[0].get("email") if owned_by else None,
        "created_at": t.get("created_date"),
        "updated_at": t.get("modified_date"),
        "sentiment": (t.get("sentiment") or {}).get("label"),
        "sla_summary": t.get("sla_summary"),
        "applies_to_part": (t.get("applies_to_part") or {}).get("name"),
        "tnt__resolution": cf.get("tnt__resolution"),
        "tnt__work_duration": cf.get("tnt__work_duration"),
    }


def sla_eval(sla: dict | None, now: datetime) -> tuple[str, int, str | None]:
    """Port of the n8n Code1 node's sla_eval."""
    if not sla:
        return "NA", 0, None

    for m in sla.get("sla_tracker", {}).get("metric_target_summaries", []):
        if (m.get("metric_definition") or {}).get("name") == "Resolution time":
            target = m.get("target_time")
            if not target:
                return "OK", 0, None

            target_dt = datetime.fromisoformat(target.replace("Z", "+00:00"))
            breach_min = int((now - target_dt).total_seconds() / 60)

            if breach_min > 0:
                return "BREACHED", breach_min, target
            return "OK", 0, target

    return "OK", 0, None


def classify_issue(text: str | None) -> str:
    """Port of the n8n Code1 node's classify_issue."""
    text = (text or "").lower()
    if "stock" in text or "inventory" in text:
        return "Inventory"
    if "api" in text:
        return "API"
    if "invoice" in text or "billing" in text:
        return "Billing"
    return "Operational"


def enrich_ticket(t: dict, now: datetime) -> dict:
    """Port of the n8n Code1 node's per-ticket enrichment."""
    sla_status, sla_breach_min, sla_due = sla_eval(t["sla_summary"], now)
    return {
        **t,
        "sla_status": sla_status,
        "sla_breach_minutes": sla_breach_min,
        "sla_due_at": sla_due,
        "issue_summary": t["title"],
        "issue_category": classify_issue(t["body"]),
        "affected_parts": t.get("applies_to_part"),
        "linked_systems": "WMS" if "WMS" in (t.get("pod") or "") else "Unknown",
    }


def build_sheet_rows(raw_tickets: list[dict], now: datetime = None) -> list[list[str]]:
    """Normalizes, enriches, dedupes (via state_db), and returns rows ready
    to append -- new tickets for *today* only, matching the n8n Code2
    node's day-scoped dedup key."""
    now = now or datetime.now(timezone.utc)
    day_key = now.strftime("%Y-%m-%d")
    now_formatted = _fmt_dt(now.isoformat())

    rows = []
    for raw in raw_tickets:
        t = enrich_ticket(normalize_ticket(raw), now)
        ticket_id = t["ticket_id"]

        if state_db.already_written(ticket_id, day_key):
            continue

        rows.append(
            [
                now_formatted,
                ticket_id,
                t.get("pod"),
                t.get("stage"),
                t.get("priority"),
                t.get("account"),
                t.get("assignee_name"),
                t.get("issue_summary"),
                t.get("affected_parts"),
                t.get("sla_status"),
                _fmt_dt(t.get("sla_due_at")),
                t.get("sla_breach_minutes"),
                _fmt_dt(t.get("created_at")),
                _fmt_dt(t.get("updated_at")),
                t.get("tnt__work_duration"),
            ]
        )
        state_db.mark_written(ticket_id, day_key, now.isoformat())

    return rows


def append_rows(rows: list[list[str]]) -> int:
    """Appends new rows to the sheet. Returns the number of rows written.
    No-ops (and warns) if Google Sheets isn't configured."""
    if not rows:
        return 0

    if not config.GOOGLE_SERVICE_ACCOUNT_FILE or not config.GOOGLE_SHEET_ID:
        print("[sheets_export] GOOGLE_SERVICE_ACCOUNT_FILE / GOOGLE_SHEET_ID not set, skipping sheet export")
        return 0

    creds = service_account.Credentials.from_service_account_file(
        config.GOOGLE_SERVICE_ACCOUNT_FILE, scopes=SCOPES
    )
    service = build("sheets", "v4", credentials=creds)

    service.spreadsheets().values().append(
        spreadsheetId=config.GOOGLE_SHEET_ID,
        range=f"{config.GOOGLE_SHEET_NAME}!A1",
        valueInputOption="USER_ENTERED",
        insertDataOption="INSERT_ROWS",
        body={"values": rows},
    ).execute()

    return len(rows)
