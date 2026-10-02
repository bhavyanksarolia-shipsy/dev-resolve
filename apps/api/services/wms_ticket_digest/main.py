#!/usr/bin/env python3
"""
WMS ticket digest -- daily DevRev -> Slack (+ Sheets) run.

Replaces the n8n "TicketUpdater" workflow. Run manually to test:

    python main.py --dry-run

Run for real (this is what cron should call):

    python main.py

See README.md for full setup and the cron entry.
"""

from __future__ import annotations

import argparse
import sys
import traceback
from datetime import datetime, timezone

from slack_sdk import WebClient

import config
import sheets_export
import state_db
from accounts import AccountNormalizer
from aggregate import build_summaries
from devrev_client import DevRevClient
from formatter import build_digest
from ownership import OwnershipResolver
from slack_client import post_alert, post_digest


def parse_args():
    parser = argparse.ArgumentParser(description="WMS ticket digest")
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Post to the test channel instead of the production channel.",
    )
    parser.add_argument(
        "--channel-override", default=None,
        help="Post to this specific Slack channel ID instead of prod/test.",
    )
    parser.add_argument(
        "--skip-sheets", action="store_true",
        help="Skip the Google Sheets export step entirely.",
    )
    return parser.parse_args()


def run(args) -> None:
    now = datetime.now(timezone.utc)
    run_ts = now.isoformat()

    devrev = DevRevClient()
    slack = WebClient(token=config.SLACK_BOT_TOKEN)

    print(f"[main] fetching tickets from DevRev...")
    tickets = devrev.fetch_tickets()
    print(f"[main] fetched {len(tickets)} tickets")

    # --- Slack digest ---
    account_normalizer = AccountNormalizer()
    summaries = build_summaries(tickets, account_normalizer)

    issue_counts: dict[str, int] = {}
    for pod_stages in summaries["dev_tickets"].values():
        for ticket_ids in pod_stages.values():
            for ticket_id in ticket_ids:
                issues = devrev.fetch_issues_for_ticket(ticket_id)
                issue_counts[ticket_id] = len(issues)

    resolver = OwnershipResolver(slack)
    digest_text = build_digest(
        summaries, issue_counts, account_normalizer.unmapped_seen, resolver
    )

    if args.channel_override:
        channel = args.channel_override
    elif args.dry_run:
        channel = config.SLACK_CHANNEL_TEST
    else:
        channel = config.SLACK_CHANNEL_PROD

    print(f"[main] posting digest to channel {channel} ({len(digest_text)} chars)")
    post_digest(slack, channel, digest_text, config.SLACK_MESSAGE_CHUNK_LIMIT)

    # --- Sheets export ---
    sheet_rows_written = 0
    if not args.skip_sheets:
        rows = sheets_export.build_sheet_rows(tickets, now)
        sheet_rows_written = sheets_export.append_rows(rows)
        print(f"[main] wrote {sheet_rows_written} new row(s) to Sheets")

    state_db.log_run(
        run_ts=run_ts,
        status="success",
        ticket_count=len(tickets),
        unmapped_accounts=account_normalizer.unmapped_seen,
        stale_poc_ids=resolver.stale_user_ids,
    )
    print("[main] run complete")


def main():
    args = parse_args()
    try:
        run(args)
    except Exception as exc:  # noqa: BLE001 - top-level guard, intentional
        tb = traceback.format_exc()
        print(tb, file=sys.stderr)

        state_db.log_run(
            run_ts=datetime.now(timezone.utc).isoformat(),
            status="failed",
            ticket_count=0,
            unmapped_accounts=set(),
            stale_poc_ids=set(),
            error=str(exc),
        )

        try:
            slack = WebClient(token=config.SLACK_BOT_TOKEN)
            post_alert(slack, config.SLACK_OPS_ALERT_CHANNEL, f"{exc}\n\n{tb[-1500:]}")
        except Exception as alert_exc:  # noqa: BLE001
            print(f"[main] failed to send failure alert: {alert_exc}", file=sys.stderr)

        sys.exit(1)


if __name__ == "__main__":
    main()
