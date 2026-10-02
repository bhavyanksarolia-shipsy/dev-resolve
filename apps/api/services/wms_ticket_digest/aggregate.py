"""
Turns the raw DevRev ticket list into the summaries the digest needs:
per-pod stage counts, per-pod account counts, and the set of tickets sitting
in a "dev" stage (whose linked issues get checked separately).

This is the equivalent of the n8n response_pretier + pod_format's stage-table
half + account_format node, minus the "build markdown text, then have a
downstream node regex-parse that markdown back into data" round trip that
Formate table did in the original. There's no reason to serialize to text
and parse it back within the same process -- that's not a fix for a
specific gap, it's just needless fragility this rewrite doesn't reproduce.
"""

from __future__ import annotations

from collections import defaultdict

import config
from accounts import AccountNormalizer


def account_display_name(ticket: dict) -> str:
    account = (ticket.get("account") or {}).get("display_name")
    if account:
        return account
    rev_org = (ticket.get("rev_org") or {}).get("display_name")
    return rev_org or "Unknown Account"


def build_summaries(tickets: list[dict], account_normalizer: AccountNormalizer) -> dict:
    """Returns a dict with:
      pod_stage:   {pod: {"total": int, "stages": {stage: count}}}
      dev_tickets: {pod: {stage: {ticket_id: account_name}}}   (DEV_STAGES only)
      pod_account: {pod: {canonical_account: count}}
    """
    pod_stage: dict = defaultdict(lambda: {"total": 0, "stages": defaultdict(int)})
    dev_tickets: dict = defaultdict(lambda: defaultdict(dict))
    pod_account: dict = defaultdict(lambda: defaultdict(int))

    for ticket in tickets:
        pod = (ticket.get("custom_fields") or {}).get("tnt__pod")
        if pod not in config.VALID_PODS:
            continue  # shouldn't happen given the API filter, but stay defensive

        stage = (ticket.get("stage") or {}).get("name")
        if stage not in config.VALID_STAGES:
            continue

        account_raw = account_display_name(ticket)
        account_canonical = account_normalizer.normalize(account_raw)

        pod_stage[pod]["total"] += 1
        pod_stage[pod]["stages"][stage] += 1
        pod_account[pod][account_canonical] += 1

        if stage in config.DEV_STAGES:
            ticket_id = ticket.get("id")
            dev_tickets[pod][stage][ticket_id] = account_canonical

    return {
        "pod_stage": pod_stage,
        "dev_tickets": dev_tickets,
        "pod_account": pod_account,
    }
