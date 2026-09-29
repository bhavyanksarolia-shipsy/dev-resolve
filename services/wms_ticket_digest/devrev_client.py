"""
DevRev API access.

Fixes, relative to the n8n version:
  * works.list is now paginated (loops on next_cursor) instead of a single
    unbounded POST -- the n8n HTTP Request node had no limit/cursor at all,
    which silently truncated results to whatever DevRev's default page size
    is once ticket volume grew past it.
  * The stage/pod filter lists are imported from config.py (one definition)
    instead of being retyped in the query body vs. a second Python
    validation list that could drift out of sync.
"""

from __future__ import annotations

import requests

import config


class DevRevClient:
    def __init__(self, token: str = config.DEVREV_TOKEN, base_url: str = config.DEVREV_BASE_URL):
        self._session = requests.Session()
        self._session.headers.update(
            {
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            }
        )
        self._base_url = base_url.rstrip("/")

    def _post(self, path: str, body: dict) -> dict:
        resp = self._session.post(f"{self._base_url}{path}", json=body, timeout=60)
        resp.raise_for_status()
        return resp.json()

    def fetch_tickets(
        self,
        valid_pods: list[str] = None,
        valid_stages: list[str] = None,
        page_limit: int = config.DEVREV_PAGE_LIMIT,
    ) -> list[dict]:
        """Fetch every ticket matching the WMS support filter, following
        cursors until DevRev stops returning one. Returns the raw `works`
        objects exactly as DevRev sends them."""
        valid_pods = valid_pods if valid_pods is not None else config.VALID_PODS
        valid_stages = valid_stages if valid_stages is not None else config.VALID_STAGES

        all_works: list[dict] = []
        cursor = None

        while True:
            body = {
                "type": config.TICKET_TYPE,
                "ticket": {"subtype": config.TICKET_SUBTYPE},
                "stage": {"name": valid_stages},
                "custom_fields": {"tnt__pod": valid_pods},
                "limit": page_limit,
            }
            if cursor:
                body["cursor"] = cursor

            data = self._post("/works.list", body)
            works = data.get("works", [])
            all_works.extend(works)

            cursor = data.get("next_cursor")
            if not cursor or not works:
                break

        return all_works

    def fetch_issues_for_ticket(self, ticket_id: str, page_limit: int = config.DEVREV_PAGE_LIMIT) -> list[dict]:
        """Same logic as the n8n Fetch Issues node: walk links.list for a
        ticket, keep anything on either side of the link typed 'issue',
        dedupe by id, follow the cursor to the end."""
        issues_by_id: dict[str, dict] = {}
        cursor = None

        while True:
            body = {"object": ticket_id, "limit": page_limit}
            if cursor:
                body["cursor"] = cursor

            data = self._post("/links.list", body)

            for link in data.get("links", []) or []:
                src = link.get("source") or {}
                tgt = link.get("target") or {}
                if src.get("type") == "issue" and src.get("id"):
                    issues_by_id[src["id"]] = src
                if tgt.get("type") == "issue" and tgt.get("id"):
                    issues_by_id[tgt["id"]] = tgt

            cursor = data.get("next_cursor")
            if not cursor:
                break

        return list(issues_by_id.values())
