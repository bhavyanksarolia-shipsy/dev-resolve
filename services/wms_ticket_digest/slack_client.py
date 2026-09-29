"""
Thin wrapper around slack_sdk for posting the digest and ops alerts.

Fixes vs. the n8n Slack node:
  * Long messages are split via formatter.chunk_message and posted as a
    root message + threaded replies, instead of one call that could be
    rejected outright if it ever exceeded Slack's size limit.
  * Failures are caught by main.py and routed to post_alert() instead of
    disappearing with no Error Workflow configured anywhere.
"""

from __future__ import annotations

from slack_sdk import WebClient
from slack_sdk.errors import SlackApiError

from formatter import chunk_message


def post_digest(client: WebClient, channel: str, text: str, chunk_limit: int) -> str:
    """Posts the digest, chunked if needed. Returns the root message ts."""
    chunks = chunk_message(text, chunk_limit)

    root = client.chat_postMessage(channel=channel, text=chunks[0])
    thread_ts = root["ts"]

    for chunk in chunks[1:]:
        client.chat_postMessage(channel=channel, text=chunk, thread_ts=thread_ts)

    return thread_ts


def post_alert(client: WebClient, channel: str, message: str) -> None:
    if not channel:
        print(f"[slack] no ops alert channel configured, alert was: {message}")
        return
    try:
        client.chat_postMessage(channel=channel, text=f":rotating_light: WMS ticket digest failed\n```{message}```")
    except SlackApiError as e:
        print(f"[slack] failed to post ops alert itself: {e}")
