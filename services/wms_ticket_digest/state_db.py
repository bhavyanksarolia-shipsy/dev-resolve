"""
Local SQLite state.

Fixes two gaps at once:
  1. "No record of whether the daily run actually succeeded" -- n8n only
     saved failed production executions, never successful ones, so there
     was no way to audit whether the digest had actually posted. Every run
     now writes a row here regardless of outcome.
  2. The Google Sheets dedup bug -- the n8n Code2 node compared against
     `items[1]` (meant to be existing sheet rows) but no node ever supplied
     a second input, so `existing_rows` was always empty and dedup never
     actually worked. This module makes dedup our own responsibility
     instead of depending on reading the sheet back.
"""

from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from pathlib import Path

import config

SCHEMA = """
CREATE TABLE IF NOT EXISTS run_log (
    run_ts TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    ticket_count INTEGER,
    unmapped_accounts TEXT,
    stale_poc_ids TEXT,
    error TEXT
);

CREATE TABLE IF NOT EXISTS sheet_rows_written (
    ticket_id TEXT NOT NULL,
    day_key TEXT NOT NULL,
    written_at TEXT NOT NULL,
    PRIMARY KEY (ticket_id, day_key)
);
"""


def _ensure_parent_dir():
    Path(config.STATE_DB_PATH).parent.mkdir(parents=True, exist_ok=True)


@contextmanager
def connect():
    _ensure_parent_dir()
    conn = sqlite3.connect(config.STATE_DB_PATH)
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        conn.executescript(SCHEMA)
        yield conn
        conn.commit()
    finally:
        conn.close()


def log_run(run_ts: str, status: str, ticket_count: int, unmapped_accounts: set, stale_poc_ids: set, error: str = None):
    with connect() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO run_log (run_ts, status, ticket_count, unmapped_accounts, stale_poc_ids, error) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (
                run_ts,
                status,
                ticket_count,
                json.dumps(sorted(unmapped_accounts)),
                json.dumps(sorted(stale_poc_ids)),
                error,
            ),
        )


def already_written(ticket_id: str, day_key: str) -> bool:
    with connect() as conn:
        row = conn.execute(
            "SELECT 1 FROM sheet_rows_written WHERE ticket_id = ? AND day_key = ?",
            (ticket_id, day_key),
        ).fetchone()
        return row is not None


def mark_written(ticket_id: str, day_key: str, written_at: str):
    with connect() as conn:
        conn.execute(
            "INSERT OR IGNORE INTO sheet_rows_written (ticket_id, day_key, written_at) VALUES (?, ?, ?)",
            (ticket_id, day_key, written_at),
        )
