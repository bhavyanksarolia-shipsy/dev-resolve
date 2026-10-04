"""
Connector relay for the Python tools (Metabase, OpenSearch). In Dev Resolve's connector mode, requests to VPN-only hosts
(DEV_RESOLVE_RELAY_SUFFIXES) are sent to the Dev Resolve server's /api/relay, which hands them to the local connector
on the laptop of the person the investigation runs for (that laptop is on the VPN). Standard library only.
"""
import base64
import json
import os
import urllib.error
import urllib.parse
import urllib.request


class ConnectorOffline(Exception):
    pass


def needs_relay(url: str) -> bool:
    if os.environ.get("DEV_RESOLVE_CONNECTOR") != "on" or not os.environ.get("DEV_RESOLVE_RELAY_URL"):
        return False
    host = (urllib.parse.urlparse(url).hostname or "").lower()
    if host in [h for h in os.environ.get("DEV_RESOLVE_RELAY_EXCLUDE", "").split(",") if h]:
        return False  # switched off in Admin → Connections: reachable without the VPN
    return any(host.endswith(s) for s in os.environ.get("DEV_RESOLVE_RELAY_SUFFIXES", "").split(",") if s)


def relay(method: str, url: str, headers: dict, body: bytes | None, timeout: float, insecure: bool = False):
    """Returns (status, headers, body_bytes). Raises ConnectorOffline / RuntimeError / TimeoutError."""
    payload = json.dumps({
        "user": os.environ.get("DEV_RESOLVE_RELAY_USER", ""),
        "req": {
            "method": method, "url": url, "headers": headers, "insecure": insecure,
            "timeout_ms": int(timeout * 1000),
            **({"body_b64": base64.b64encode(body).decode()} if body is not None else {}),
        },
    }).encode()
    req = urllib.request.Request(
        os.environ["DEV_RESOLVE_RELAY_URL"], data=payload, method="POST",
        headers={"Content-Type": "application/json", "x-relay-secret": os.environ.get("DEV_RESOLVE_RELAY_SECRET", "")},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout + 20) as resp:
            r = json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        try:
            err = json.loads(e.read().decode())
        except Exception:
            err = {"error": f"HTTP {e.code}"}
        if err.get("code") == "CONNECTOR_OFFLINE":
            raise ConnectorOffline(err.get("error", "connector offline"))
        raise RuntimeError(err.get("error", f"relay HTTP {e.code}"))
    return r["status"], r.get("headers", {}), base64.b64decode(r.get("body_b64", ""))


VPN_VIA_CONNECTOR_HINT = (
    "VPN_REQUIRED: this host is only reachable over the client VPN, which Dev Resolve reaches through the local connector "
    "on the laptop of the person who started this investigation — and it isn't running or that laptop isn't on the VPN. "
    "They need to connect the VPN and start the connector (Dev Resolve → Connector page), then retry this exact command. "
    "Don't report this as a data-not-found result."
)
