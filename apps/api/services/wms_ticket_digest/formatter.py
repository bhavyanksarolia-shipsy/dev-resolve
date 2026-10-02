"""
Builds the Slack digest message(s) from the aggregated data.

Fixes vs. the n8n Formate table node:
  * Hard length check with a real split into multiple messages instead of
    one unbounded string handed to a "Simple Text Message" Slack node.
  * Unmapped accounts and stale POC mentions are rendered as their own
    visible section instead of being silently swallowed.
"""

from __future__ import annotations

from datetime import datetime

from ownership import OwnershipResolver

WEEKDAY_GREETINGS = {
    "Monday": "Happy Monday! Let's kick-start the week strong.",
    "Tuesday": "Tuesday momentum - keep pushing!",
    "Wednesday": "Midweek focus - progress over perfection.",
    "Thursday": "Almost there - great day to close blockers.",
    "Friday": "Finish strong! Let's clean up the backlog.",
    "Saturday": "Weekend watch - thanks for the support!",
    "Sunday": "Quiet Sunday ops check - appreciate the effort.",
}


def weekday_greeting(now: datetime = None) -> str:
    now = now or datetime.utcnow()
    return WEEKDAY_GREETINGS.get(now.strftime("%A"), "Hello Team!")


def _readable_stage(stage: str) -> str:
    return stage.replace("_", " ").title()


def build_pod_stage_section(pod: str, pod_data: dict, resolver: OwnershipResolver) -> list[str]:
    lines = [f"*{pod}* ({pod_data['total']})"]
    for stage, count in pod_data["stages"].items():
        mention_text, _stale = resolver.resolve_mentions(pod, stage)
        lines.append(f"    - {_readable_stage(stage)} - {count} {mention_text}")
    lines.append("")
    return lines


def build_pod_account_section(pod: str, account_counts: dict) -> list[str]:
    lines = [f"*{pod} - Account Summary*"]
    for account, count in sorted(account_counts.items(), key=lambda kv: kv[1], reverse=True):
        lines.append(f"    - {account} - {count}")
    lines.append("")
    return lines


def build_dev_tickets_section(dev_tickets: dict, issue_counts: dict[str, int]) -> list[str]:
    """dev_tickets: {pod: {stage: {ticket_id: account}}}
    issue_counts: {ticket_id: linked_issue_count}, populated by main.py after
    calling DevRevClient.fetch_issues_for_ticket for each dev-stage ticket."""
    rows = []
    for pod, stages in dev_tickets.items():
        for stage, tickets in stages.items():
            for ticket_id, account in tickets.items():
                rows.append(
                    f"    - {ticket_id} ({pod} / {_readable_stage(stage)}, {account}) - "
                    f"{issue_counts.get(ticket_id, 0)} linked issue(s)"
                )

    if not rows:
        return ["*DevTickets - Issues*", "_No dev tickets/issues found._", ""]

    return ["*DevTickets - Issues*", *rows, ""]


def build_unmapped_section(unmapped_accounts: set[str]) -> list[str]:
    if not unmapped_accounts:
        return []
    lines = ["*Unmapped accounts (needs review in config/accounts.json)*"]
    lines.extend(f"    - {name}" for name in sorted(unmapped_accounts))
    lines.append("")
    return lines


def build_digest(
    summaries: dict,
    issue_counts: dict[str, int],
    unmapped_accounts: set[str],
    resolver: OwnershipResolver,
) -> str:
    parts = [f"{weekday_greeting()}", "Hey <!channel> - devShip here!!", ""]

    for pod, pod_data in summaries["pod_stage"].items():
        parts.extend(build_pod_stage_section(pod, pod_data, resolver))

    for pod, account_counts in summaries["pod_account"].items():
        parts.extend(build_pod_account_section(pod, account_counts))

    parts.extend(build_dev_tickets_section(summaries["dev_tickets"], issue_counts))
    parts.extend(build_unmapped_section(unmapped_accounts))

    return "\n".join(parts).strip()


def chunk_message(text: str, limit: int) -> list[str]:
    """Split on blank-line boundaries so we never cut a line in half, always
    staying under `limit` characters per chunk."""
    if len(text) <= limit:
        return [text]

    chunks, current = [], []
    current_len = 0
    for block in text.split("\n\n"):
        block_len = len(block) + 2
        if current_len + block_len > limit and current:
            chunks.append("\n\n".join(current))
            current, current_len = [], 0
        current.append(block)
        current_len += block_len

    if current:
        chunks.append("\n\n".join(current))

    return chunks
