#!/usr/bin/env python3
"""Trace every Bucket-2 (no pick task created) store/SKU pair in a labelled
failures CSV and classify each by the last inventory callback published
before the order arrived.

    python3 b2_classify.py --input failures_labelled.csv --out b2_traces.json [--workers 10]

--input must be a CSV with at least these columns: bucket, warehouse, sku,
order_date (order_date as 'YYYY-MM-DD HH:MM:SS...'). Only rows whose
`bucket` starts with '2' are traced (Bucket 2 = no pick task created).

Needs the RIL VPN. OpenSearch auth comes from RELIANCE_OS_USERNAME/PASSWORD
in Dev Resolve's config/ folder config.env (or OS_USER/OS_PASS env vars) —
vf-wms-os.ril.com is not reachable anonymously from this machine.
"""
import argparse
import csv
import json
import os
import re
import subprocess
import datetime
from concurrent.futures import ThreadPoolExecutor

IST = datetime.timezone(datetime.timedelta(hours=5, minutes=30))


def _reliance_config():
    p = os.path.join(os.environ.get("DEV_RESOLVE_CONFIG_DIR") or os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "..", "config")), "config.env")
    if not os.path.exists(p):
        return {}
    kv = {}
    for line in open(p):
        line = line.strip()
        if "=" in line and not line.startswith("#"):
            k, v = line.split("=", 1)
            kv[k.strip()] = v.strip()
    return kv


_cfg = _reliance_config()
_OS_USER = os.environ.get("OS_USER") or _cfg.get("RELIANCE_OS_USERNAME")
_OS_PASS = os.environ.get("OS_PASS") or _cfg.get("RELIANCE_OS_PASSWORD")


def os_search(f, size=200):
    body = {"size": size, "sort": [{"timestamp": "desc"}], "query": {"bool": {"filter": f}}}
    args = ["curl", "-s", "--max-time", "90", "-X", "POST",
            "https://vf-wms-os.ril.com/api/console/proxy?path=app-logs-*ril-qc-prod/_search&method=POST",
            "-H", "Content-Type: application/json", "-H", "osd-xsrf: true"]
    if _OS_USER and _OS_PASS:
        args += ["-u", f"{_OS_USER}:{_OS_PASS}"]
    out = subprocess.run(args + ["-d", json.dumps(body)],
                         capture_output=True, text=True).stdout
    try:
        return [h["_source"] for h in json.loads(out)["hits"]["hits"]]
    except Exception:
        return []


def trace(pair):
    (wh, sku), ot = pair
    lo = (ot - datetime.timedelta(days=12)).strftime("%Y-%m-%dT%H:%M:%S")
    hi = ot.strftime("%Y-%m-%dT%H:%M:%S")
    hits = os_search([{"match_phrase": {"filename": "stream.py"}},
                       {"match_phrase": {"message": sku}}, {"match_phrase": {"message": wh}},
                       {"range": {"timestamp": {"gte": lo + "+05:30", "lte": hi + "+05:30"}}}])
    ev = {}
    for h in hits:
        m, rid = h.get("message", ""), h.get("request_id", "")
        try:
            dt = datetime.datetime.fromisoformat(h["timestamp"]).astimezone(IST).replace(tzinfo=None)
        except Exception:
            continue
        e = ev.setdefault(rid or dt.isoformat(), dict(t=dt, total=None, reserved=None, pub=None))
        e["t"] = min(e["t"], dt)
        # published qty: always scoped to this SKU's entry in the Kafka payload
        mm = re.search(r"'article':\s*'%s'[^}]*?'quantity':\s*([\d.]+)" % re.escape(sku), m)
        if mm:
            e["pub"] = float(mm.group(1))
        # KNOWN BUG (open): total_quantity / reserved_quantity are read from the
        # pre-transformation payload, which on a MULTI-SKU batch contains one entry
        # per article. A bare regex returns the FIRST entry -- i.e. another SKU's
        # numbers. Only trust them when the message carries a single article.
        if m.count("'article':") <= 1:
            for k, pat in (("total", r"'total_quantity':\s*([\d.]+)"),
                           ("reserved", r"'reserved_quantity':\s*([\d.]+)")):
                mm = re.search(pat, m)
                if mm:
                    e[k] = float(mm.group(1))
        else:
            e["multi_sku"] = True
    evs = sorted([e for e in ev.values() if e["t"] < ot], key=lambda x: x["t"])
    if not evs:
        return (wh, sku), dict(cls="No callback found", pub=None, total=None, reserved=None, gap_h=None)
    last = evs[-1]
    gap = (ot - last["t"]).total_seconds() / 3600
    p, t_, r_ = last["pub"], last["total"], last["reserved"]
    if p is None:
        cls = "No quantity parsed"
    elif p > 0 and gap > 6:
        cls = "Stale positive feed"
    elif p > 0:
        cls = "Published >0 — allocation still failed"
    elif t_ is None or t_ == 0:
        cls = "Genuine stock-out"
    elif r_ is not None and r_ >= t_:
        cls = "Last-unit race"
    elif t_ > 1 and (r_ or 0) == 0:
        cls = "Availability lock (stock held back)"   # only safe when total>1
    elif t_ == 1:
        cls = "Last-unit race (total 1 — lock indistinguishable)"
    else:
        cls = "Partly reserved"
    return (wh, sku), dict(cls=cls, pub=p, total=t_, reserved=r_, gap_h=gap)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--input", required=True, help="Labelled failures CSV (needs bucket, warehouse, sku, order_date columns)")
    ap.add_argument("--out", required=True, help="Output JSON path for the traced classifications")
    ap.add_argument("--workers", type=int, default=10, help="Parallel OpenSearch lookups (default 10)")
    args = ap.parse_args()

    if not (_OS_USER and _OS_PASS):
        print("Warning: no OpenSearch credentials found (RELIANCE_OS_USERNAME/PASSWORD "
              "in Dev Resolve's config/ folder config.env, or OS_USER/OS_PASS env vars) — "
              "requests will likely 401.", flush=True)

    with open(args.input) as f:
        d = [r for r in csv.DictReader(f) if r["bucket"].startswith("2")]

    first = {}
    for r in d:
        k = (r["warehouse"], r["sku"])
        t = datetime.datetime.strptime(r["order_date"][:19], "%Y-%m-%d %H:%M:%S")
        if k not in first or t < first[k]:
            first[k] = t
    pairs = list(first.items())

    print(f"Bucket 2: {len(d)} lines across {len(pairs)} store/SKU pairs — tracing...", flush=True)
    res = {}
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        for k, v in ex.map(trace, pairs):
            res[k] = v

    with open(args.out, "w") as f:
        json.dump({f"{k[0]}|{k[1]}": v for k, v in res.items()}, f, default=str)
    print("done", len(res))


if __name__ == "__main__":
    main()
