# WMS Ticket Digest

Standalone Python replacement for the n8n "TicketUpdater" workflow. Pulls
WMS support tickets from DevRev, posts a Slack digest, and appends new
tickets to a Google Sheet. Runs once per invocation -- schedule it with
cron.

## Setup

```bash
cd wms_ticket_digest
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

cp .env.example .env
# edit .env: DEVREV_TOKEN, SLACK_BOT_TOKEN, and Google Sheets settings if you want that export

mkdir -p state   # local SQLite state lives here, not committed to git
```

**Rotate the DevRev token first.** The token in the old n8n workflow was
pasted in plaintext into node bodies that anyone with workflow access (or an
AI agent, which is how this was found) could read. Generate a new one in
DevRev and put only the new one in `.env`.

`.env` should never be committed. Add it to `.gitignore` and `chmod 600 .env`
on the server.

## Test before trusting it

```bash
python main.py --dry-run
```

Posts to the test channel (`SLACK_CHANNEL_TEST`) instead of production, so
you can confirm it looks right before it starts posting to the real channel
on a schedule.

## Running it for real

```bash
python main.py
```

## Scheduling (cron)

The n8n version ran daily at 10:30 IST. Example crontab entry (adjust the
paths):

```cron
30 10 * * * flock -n /tmp/wms_digest.lock /path/to/wms_ticket_digest/venv/bin/python /path/to/wms_ticket_digest/main.py >> /path/to/wms_ticket_digest/logs/run.log 2>&1
```

`flock -n` prevents two runs from overlapping if one is ever still running
when the next fires -- the n8n schedule trigger had no such guard.

If you're not on a Linux server, `main.py` itself is plain Python with no
OS-specific assumptions -- use `launchd` on macOS or Task Scheduler on
Windows to call the same command on the same schedule.

## What changed vs. the n8n workflow, and why

| Gap found in the n8n workflow | Fix in this rewrite |
|---|---|
| API tokens hardcoded in plaintext in node bodies | All secrets loaded from `.env`, never in source |
| `works.list` fetch had no pagination -- silently truncated past DevRev's default page size | `devrev_client.py` loops on `next_cursor` until exhausted |
| Query-level stage filter and the Python `VALID_STAGES` list could drift apart (one had "resolved", the other didn't) | Single list in `config/stages.json`, imported everywhere |
| POC/Slack-mention mapping was hardcoded individual user IDs with no offboarding check -- a departed employee kept getting tagged | `ownership.py` checks every mapped ID against Slack's `users.info` before every run and calls out stale ones in the digest instead of silently tagging them. (Real fix is a Slack User Group per pod so membership changes don't need a code/config edit at all -- revisit if you get Slack admin access.) |
| Unrecognized account names silently passed through unmerged, creating duplicate rows | `accounts.py` fuzzy-matches near-variants and explicitly flags anything it can't resolve in an "Unmapped accounts" section |
| No length guard on the final Slack message | `formatter.chunk_message` splits into a threaded follow-up if the digest gets long |
| No Error Workflow -- a failed run vanished with no alert | `main.py` catches any failure, logs it to `state_db`, and posts to `SLACK_OPS_ALERT_CHANNEL` |
| n8n only saved *failed* production executions, never successful ones -- no way to audit whether the daily post actually happened | Every run (success or failure) writes a row to the local `run_log` table in `state/wms_digest.sqlite3` |
| Google Sheets export branch had no trigger attached at all, and its dedup compared against an input no node ever supplied, so dedup never worked | Rebuilt with a real trigger (this script) and dedup backed by a local SQLite table (`sheet_rows_written`), not a broken "read the sheet back" pattern |
| Two Text Classifier nodes sat on the canvas fully unconfigured and disconnected | Not reproduced -- they did nothing in the original either |
| Two parallel copies of the entire pipeline (one for schedule, one for manual testing) | One script, `--dry-run` / `--channel-override` flags instead of a duplicated lane |

## Files

- `main.py` -- entry point / orchestration
- `config.py` + `config/*.json` -- all settings, stage/pod lists, POC mapping, account aliases
- `devrev_client.py` -- DevRev API calls (paginated)
- `aggregate.py` -- builds pod/stage/account summaries
- `accounts.py` -- account-name normalization with fuzzy fallback
- `ownership.py` -- POC mention resolution + deactivated-user check
- `formatter.py` -- builds the Slack message text, splits if too long
- `slack_client.py` -- posts the digest + failure alerts
- `sheets_export.py` -- ticket enrichment (SLA/issue classification) + Sheets append
- `state_db.py` -- local SQLite: run history + sheet dedup

## Known gaps in this rewrite (be aware, not silent)

- `config/accounts.json` is seeded from what was visible in the n8n
  workflow's UI, not exported programmatically -- treat it as a starting
  point and review it against your real DevRev account list.
- `config/poc_map.json` has no entries for the bare `"WMS"` pod (neither did
  the original) -- add them if tickets ever get tagged that way instead of
  Inbound/Outbound.
- The deactivated-user check only catches people Slack has actually
  deactivated or removed. If someone leaves the *team* but keeps their
  Slack account active org-wide, this script has no way to know -- update
  `config/poc_map.json` as part of offboarding.
