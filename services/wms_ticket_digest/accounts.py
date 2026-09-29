"""
Account-name normalization.

The n8n account_format node's fallback for an unrecognized name was
`match_account.get(raw_account, raw_account)` -- i.e. pass it through
unchanged. That means a renamed or newly-onboarded customer doesn't merge
with its existing line item, it just shows up as a second, phantom row.

Fix: try the explicit alias table first (fast, exact), then fall back to
fuzzy matching against the set of already-known canonical names. Anything
that doesn't clear the threshold gets returned as-is but ALSO reported back
to the caller as "unmapped", so the digest can surface it as a visible
"needs mapping" line instead of silently fragmenting the account table.
"""

from __future__ import annotations

from rapidfuzz import fuzz, process

import config

FUZZY_MATCH_THRESHOLD = 90  # 0-100; tune if it's too eager/too strict


class AccountNormalizer:
    def __init__(self, alias_map: dict[str, str] = None):
        self._alias_map = {k: v for k, v in (alias_map or config.ACCOUNT_ALIASES).items() if not k.startswith("_")}
        self._canonical_names = sorted(set(self._alias_map.values()))
        self.unmapped_seen: set[str] = set()

    def normalize(self, raw_account: str) -> str:
        if not raw_account:
            return "Unknown Account"

        # 1. Exact match against the alias table (fast path, matches n8n behavior).
        if raw_account in self._alias_map:
            return self._alias_map[raw_account]

        # 2. Fuzzy match against known canonical names (handles near-variants
        #    the alias table hasn't caught up to yet: trailing spaces,
        #    "Pvt Ltd" suffixes, minor typos).
        if self._canonical_names:
            match = process.extractOne(
                raw_account, self._canonical_names, scorer=fuzz.WRatio
            )
            if match and match[1] >= FUZZY_MATCH_THRESHOLD:
                return match[0]

        # 3. Give up and flag it -- surfaced in the digest, not swallowed.
        self.unmapped_seen.add(raw_account)
        return raw_account
