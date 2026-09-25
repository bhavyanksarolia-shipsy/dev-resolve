#!/usr/bin/env python3
"""Why was this order line cut? — RIL-QC per-order miss diagnosis.

    trace_order.py <order_reference> [--sku SKU] [--events N]

Answers, per SKU on the order:
  1. Was a pick task created?
  2. If yes  -> what happened at the bin (short pick reason, location, picker)?
  3. If no   -> what inventory quantity did we last publish before the order arrived?

Reads ClickHouse via Metabase (api key from the metabase-query skill) and the
WMS application logs from OpenSearch (anonymous). Requires the RIL network/VPN.
"""
import json, os, re, subprocess, sys, argparse
from datetime import datetime, timedelta, timezone

IST = timezone(timedelta(hours=5, minutes=30))
OS_HOST = os.environ.get("OS_HOST", "https://vf-wms-os.ril.com")
OS_INDEX = os.environ.get("OS_INDEX", "app-logs-*ril-qc-prod")
MB_HOST = os.environ.get("METABASE_URL", "https://vf-wms-metabase.ril.com")
CH_DB = int(os.environ.get("CH_DB", 5))          # 5 = QC ClickHouse PROD
CREDS = os.path.expanduser("~/.claude/skills/metabase-query/.credentials")
RELIANCE_CONFIG = os.path.join(os.environ.get("DEV_RESOLVE_CONFIG_DIR") or os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "..", "config")), "config.env")


def _reliance_config():
    if not os.path.exists(RELIANCE_CONFIG):
        return {}
    kv = {}
    for line in open(RELIANCE_CONFIG):
        line = line.strip()
        if "=" in line and not line.startswith("#"):
            k, v = line.split("=", 1)
            kv[k.strip()] = v.strip()
    return kv


def mb_token():
    t = os.environ.get("METABASE_TOKEN")
    if t:
        return t
    if os.path.exists(CREDS):
        host = re.sub(r"[^A-Za-z0-9]", "_", MB_HOST.split("//")[-1].split("/")[0]).upper()
        kv = {}
        for line in open(CREDS):
            if "=" in line and not line.strip().startswith("#"):
                k, v = line.split("=", 1)
                kv[k.strip()] = v.strip()
        found = kv.get(f"METABASE_TOKEN_{host}") or kv.get("METABASE_TOKEN")
        if found:
            return found
    # Fall back to the reliance-tools skill's own session token, since that's
    # the credential store this machine actually uses (confirmed 2026-09-12 —
    # the ~/.claude/skills/metabase-query/.credentials path above is stale).
    return _reliance_config().get("RELIANCE_METABASE_SESSION_TOKEN", "")


def _os_auth():
    """(username, password) tuple for OpenSearch Basic Auth, or None.
    NOTE 2026-09-12: contrary to this skill's docs, vf-wms-os.ril.com is NOT
    reachable anonymously from this machine — confirmed via direct curl test
    (401 Unauthorized with no auth, then 400 "must contain osd-xsrf" with
    Basic Auth added, then 200 once osd-xsrf was also present). Falls back to
    the reliance-tools config.env credentials if OS_USER/OS_PASS aren't set."""
    user = os.environ.get("OS_USER") or _reliance_config().get("RELIANCE_OS_USERNAME")
    pw = os.environ.get("OS_PASS") or _reliance_config().get("RELIANCE_OS_PASSWORD")
    return (user, pw) if user and pw else None


def curl(url, body, headers, auth=None):
    # python urllib rejects the corporate MITM CA; curl trusts the system keychain
    args = ["curl", "-s", "--max-time", "180", "-X", "POST", url,
            "-H", "Content-Type: application/json"]
    if auth:
        args += ["-u", f"{auth[0]}:{auth[1]}"]
    for h in headers:
        args += ["-H", h]
    out = subprocess.run(args + ["-d", json.dumps(body)],
                         capture_output=True, text=True).stdout
    if not out.strip():
        sys.exit(f"Empty response from {url} — on the VPN?")
    return json.loads(out)


def ch(query):
    tok = mb_token()
    if not tok:
        sys.exit("No Metabase token. Set METABASE_TOKEN, or run the reliance-metabase-query "
                 "skill's `query.py whoami --project wms` once to establish a session.")
    hdr = "x-api-key" if tok.startswith("mb_") else "x-metabase-session"
    d = curl(f"{MB_HOST}/api/dataset",
             {"database": CH_DB, "type": "native", "native": {"query": query}},
             [f"{hdr}: {tok}"])
    if d.get("status") == "failed" or "data" not in d:
        sys.exit("Metabase error: " + json.dumps(d.get("error") or d)[:600])
    cols = [c["name"] for c in d["data"]["cols"]]
    return [dict(zip(cols, r)) for r in d["data"]["rows"]]


def os_search(filters, size=400, order="asc"):
    body = {"size": size, "sort": [{"timestamp": order}],
            "query": {"bool": {"filter": filters}}}
    d = curl(f"{OS_HOST}/api/console/proxy?path={OS_INDEX}/_search&method=POST",
             body, ["osd-xsrf: true"], auth=_os_auth())
    if "hits" not in d:
        sys.exit("OpenSearch error: " + json.dumps(d)[:600])
    return [h["_source"] for h in d["hits"]["hits"]]


def ts(s):
    if not s:
        return None
    s = str(s).replace("T", " ")[:19]
    try:
        return datetime.strptime(s, "%Y-%m-%d %H:%M:%S")
    except ValueError:
        return None


def stream_events(store, sku, order_dt=None, days=14):
    """Inventory-stream events for a store+SKU, oldest first, one row per event.

    WMS writes ~3 log lines per streamed event: the pre-transformation payload
    (total/reserved/available) and the Kafka payload (the quantity actually
    published). They share a request_id, so merge on that — otherwise total and
    published land on separate rows and the verdict is wrong.

    NOTE: there is NO server-side date filter and the index spans many days.
    Always compare FULL datetimes, never time-of-day."""
    f = [{"match_phrase": {"filename": "stream.py"}},
         {"match_phrase": {"message": str(sku)}},
         {"match_phrase": {"message": str(store)}}]
    if order_dt:                       # bound the window, and take the LATEST hits
        lo = (order_dt - timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%S")
        hi = (order_dt + timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%S")
        f.append({"range": {"timestamp": {"gte": lo + "+05:30", "lte": hi + "+05:30"}}})
    hits = os_search(f, 600, "desc")
    ev = {}
    for h in hits:
        m, rid = h.get("message", ""), h.get("request_id", "")
        try:
            dt = datetime.fromisoformat(h.get("timestamp", "")).astimezone(IST).replace(tzinfo=None)
        except Exception:
            continue
        key = rid or dt.isoformat()
        e = ev.setdefault(key, dict(t=dt, total=None, reserved=None, available=None,
                                    published=None, trigger="", request_id=rid))
        e["t"] = min(e["t"], dt)
        pre = re.search(r"'total_quantity':\s*([\d.]+)", m)
        rsv = re.search(r"'reserved_quantity':\s*([\d.]+)", m)
        avl = re.search(r"'available_quantity':\s*([\d.]+)", m)
        pub = re.search(r"'article':\s*'%s'[^}]*?'quantity':\s*([\d.]+)" % re.escape(str(sku)), m)
        if pre: e["total"] = float(pre.group(1))
        if rsv: e["reserved"] = float(rsv.group(1))
        if avl: e["available"] = float(avl.group(1))
        if pub: e["published"] = float(pub.group(1))
        trg = re.search(r"trigger['\"]?\s*[:=]\s*['\"]?(\w+)", m)
        if trg and not e["trigger"]: e["trigger"] = trg.group(1)
        elif not e["trigger"] and h.get("funcname") not in ("push_to_stream_topics", ""):
            e["trigger"] = h.get("funcname", "")
    return sorted(ev.values(), key=lambda x: x["t"])


def concurrent_demand(store, sku, order_dt, window=90):
    """Distinct stream requests firing around the order time.

    WMS raises one request per allocation attempt, so >1 distinct request_id
    inside a short window means several orders were competing for the same
    stock — the last-unit race."""
    lo = (order_dt - timedelta(seconds=window)).strftime("%Y-%m-%dT%H:%M:%S")
    hi = (order_dt + timedelta(seconds=window)).strftime("%Y-%m-%dT%H:%M:%S")
    hits = os_search([{"match_phrase": {"filename": "stream.py"}},
                      {"match_phrase": {"message": str(sku)}},
                      {"match_phrase": {"message": str(store)}},
                      {"range": {"timestamp": {"gte": lo + "+05:30", "lte": hi + "+05:30"}}}], 400, "asc")
    rids = set()
    for h in hits:
        try:
            dt = datetime.fromisoformat(h.get("timestamp", "")).astimezone(IST).replace(tzinfo=None)
        except Exception:
            continue
        if abs((dt - order_dt).total_seconds()) <= window:
            rids.add(h.get("request_id") or dt.isoformat())
    return len(rids)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("order")
    ap.add_argument("--sku")
    ap.add_argument("--events", type=int, default=6)
    a = ap.parse_args()
    ref = a.order if "-" in a.order else a.order + "-01"
    base = ref.split("-")[0]

    lines = ch(f"""
      SELECT order_reference, warehouse, order_detail_id, line_reference, sku_code, sku_desc,
             order_status, line_status, original_quantity, quantity, cancelled_quantity,
             allocated_quantity, open_quantity, order_date
      FROM (SELECT *, row_number() OVER (PARTITION BY order_detail_id
                     ORDER BY max_updation_date DESC) rn
            FROM stockone_analytics.fact_order_lines
            WHERE order_reference LIKE '{base}%') WHERE rn=1
      ORDER BY toInt32OrZero(line_reference)""")
    if not lines:
        sys.exit(f"No order lines found for {ref}")
    picks = ch(f"""
      SELECT order_detail_id, sku_code, picklist_number, status, reason, location, zone,
             picklist_quantity, reserved_quantity, picked_quantity, picker_username,
             creation_date, task_updation_date
      FROM (SELECT *, row_number() OVER (PARTITION BY picklist_id
                     ORDER BY max_updation_date DESC) rn
            FROM stockone_analytics.fact_picks
            WHERE order_reference LIKE '{base}%') WHERE rn=1""")
    by_line = {}
    for p in picks:
        by_line.setdefault(str(p["order_detail_id"]), []).append(p)

    wh = lines[0]["warehouse"]
    od = ts(lines[0]["order_date"])
    print("=" * 92)
    print(f"ORDER {lines[0]['order_reference']}   store {wh}   placed {od}   "
          f"{len(lines)} line(s)")
    print("=" * 92)

    for L in lines:
        if a.sku and str(L["sku_code"]) != str(a.sku):
            continue
        pk = by_line.get(str(L["order_detail_id"]), [])
        cancelled = float(L["cancelled_quantity"] or 0)
        print(f"\nline {L['line_reference']}  SKU {L['sku_code']}  {L['sku_desc'][:46]}")
        print(f"   ordered {L['original_quantity']}   cancelled {cancelled}   "
              f"allocated {L['allocated_quantity']}   line_status {L['line_status']}")
        if not cancelled:
            print("   -> FULFILLED (nothing cancelled on this line)")
            continue

        if pk:
            print(f"   -> PICK TASK WAS CREATED  ({len(pk)} task(s))  "
                  "=> failure happened ON THE FLOOR")
            for p in pk:
                print(f"      picklist {p['picklist_number']}  status={p['status']}  "
                      f"reason={p['reason'] or '-'}")
                print(f"      location={p['location'] or '-'}  zone={p['zone'] or '-'}  "
                      f"picker={p['picker_username'] or '-'}")
                print(f"      picklist_qty={p['picklist_quantity']}  "
                      f"reserved={p['reserved_quantity']}  picked={p['picked_quantity']}")
            loc = (pk[0]["location"] or "").strip()
            real = bool(re.match(r"^\d{3}-\d+-\d+$", loc))
            if loc:
                print(f"      bin check: {loc} is {'a REAL bin -> stock record was wrong'
                                                   if real else 'NOT a physical bin -> putaway was wrong'}")
            continue

        # ---- no pick task: what did we publish before the order?
        print("   -> NO PICK TASK WAS CREATED  => nothing could be allocated at order time")
        ev = stream_events(wh, L["sku_code"], od)
        before = [e for e in ev if od and e["t"] < od]
        if not ev:
            print("      no stream events found (check store code / VPN)")
            continue
        if not before:
            print("      no stream event before the order")
            continue
        print(f"      last {min(a.events, len(before))} callback(s) before the order:")
        for e in before[-a.events:]:
            print(f"        {e['t']}  {e['trigger'][:22]:<22} total={e['total']}  "
                  f"reserved={e['reserved']}  published={e['published']}")
        last = before[-1]
        gap = (od - last["t"]).total_seconds()
        gs = (f"{gap:.0f}s" if gap < 120 else f"{gap/60:.0f} min" if gap < 7200
              else f"{gap/3600:.1f} h" if gap < 86400 else f"{gap/86400:.1f} days")
        print(f"\n      LAST CALLBACK: {last['t']}  published={last['published']}  ({gs} before the order)")
        pubd, tot, res = last["published"], last["total"], last["reserved"]
        if pubd == 0 and tot and res is not None and res >= tot:
            v = "LAST-UNIT RACE — the stock was already reserved by an earlier order. We published 0 correctly."
        elif pubd == 0 and tot and (res or 0) == 0:
            v = "CYCLE-COUNT LOCK — stock sits on the shelf but is withheld (total>0, reserved=0, available=0)."
        elif pubd == 0 and not tot:
            v = "GENUINE STOCK-OUT — we published 0 correctly; the order was accepted anyway (their gap)."
        elif pubd == 0:
            v = "We published 0 before the order; the order was accepted anyway."
        elif pubd:
            races = concurrent_demand(wh, L["sku_code"], od)
            if races > 1:
                v = (f"OVERSELL OF THE LAST UNIT(S) — we published {pubd:g} and {races} picklist requests "
                     f"fired within 90s of the order. More orders than units.")
            elif gap > 6 * 3600:
                v = (f"STALE FEED — we last published {pubd:g} and never updated it ({gs} old). "
                     "Stock went to zero with no callback. OUR gap.")
            else:
                v = (f"We published {pubd:g} {gs} before the order and stock was gone by order time — "
                     "check for a stock movement that did not fire a callback.")
        else:
            v = "No quantity parsed on the last callback — inspect the raw log."
        print(f"      VERDICT: {v}")


if __name__ == "__main__":
    main()
