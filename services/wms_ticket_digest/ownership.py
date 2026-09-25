"""
Resolves who gets @mentioned for a given pod+stage, and guards against the
exact bug this rewrite was triggered by: a departed employee's Slack ID
staying hardcoded in the mapping and getting tagged forever.

Real fix (not available right now -- no Slack admin access to create User
Groups): mapping stays as individual user IDs in config/poc_map.json.

Safety net (this module): before every run, check each mapped user ID
against Slack's users.info. Anything Slack reports as deleted/deactivated
is dropped from the mention list and the digest says so explicitly instead
of silently tagging nobody or a dead account.
"""

from __future__ import annotations

from slack_sdk import WebClient
from slack_sdk.errors import SlackApiError

import config


class OwnershipResolver:
    def __init__(self, slack_client: WebClient):
        self._slack = slack_client
        self._active_cache: dict[str, bool] = {}

    def _is_active(self, user_id: str) -> bool:
        """Cached per-run lookup. Returns False for deleted/deactivated
        users or users Slack doesn't recognize at all (e.g. removed from
        the workspace outright)."""
        if user_id in self._active_cache:
            return self._active_cache[user_id]

        try:
            resp = self._slack.users_info(user=user_id)
            user = resp.get("user", {})
            active = not user.get("deleted", False) and not user.get("is_bot", False)
        except SlackApiError as e:
            # user_not_found means they're fully gone from the workspace.
            # Any other error we fail safe (treat as inactive) rather than
            # risk tagging someone we couldn't verify.
            active = False
            if e.response and e.response.get("error") not in ("user_not_found",):
                print(f"[ownership] warning: users_info failed for {user_id}: {e}")

        self._active_cache[user_id] = active
        return active

    def resolve_mentions(self, pod: str, stage: str) -> tuple[str, list[str]]:
        """Returns (mention_text, stale_user_ids). mention_text is ready to
        drop straight into a Slack message."""
        user_ids = config.POC_MAP.get(pod, {}).get(stage, [])

        if not user_ids:
            return "_POC not defined_", []

        live, stale = [], []
        for uid in user_ids:
            (live if self._is_active(uid) else stale).append(uid)

        if not live:
            return "_POC left org - needs reassignment in config/poc_map.json_", stale

        mention_text = " ".join(f"<@{uid}>" for uid in live)
        if stale:
            mention_text += " _(one or more mapped POCs for this stage have left -- check config/poc_map.json)_"

        return mention_text, stale

    @property
    def stale_user_ids(self) -> set[str]:
        """All user IDs seen so far this run that Slack reports as
        deleted/deactivated/bot -- use this after the run to know what
        needs fixing in config/poc_map.json."""
        return {uid for uid, active in self._active_cache.items() if not active}
