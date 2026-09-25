#!/usr/bin/env python3
"""QC cancellation RCA pipeline: extract -> exclusions -> two buckets -> waterfall.

  python3 rca.py CANCEL_EXTRACT [--picks picks.csv] [--velocity vel.csv]
                 [--out DIR] [--label 02Sep] [--cutoff HH:MM]

CANCEL_EXTRACT: the "cancel — line level detail" .xlsx or .csv (28 cols).
--picks       : fact_picks export (order_reference, sku_code, location) for location analysis.
--velocity    : fact_order_lines counts (warehouse, sku_code, order_lines) for the fast/slow split.
--cutoff      : truncate to HH:MM — use to compare a full day against a partial extract.
"""
import argparse, csv, collections, datetime, json, os, re, sys

BIN = re.compile(r'^\d{3}-\d+-\d+$')      # the ONLY real bin shape
DOT = re.compile(r'^\d+(\.\d+)+$')
BIG = re.compile(r'^\d{4,}-\d+-\d+$')
INTEGRATION_USER = 'rildsintegrationuser@shipsy.io'


def fl(x):
    try: return float(x)
    except (TypeError, ValueError): return 0.0


def norm_dt(s):
    """CSV exports carry 'September 2, 2026, 11:05 PM'; xlsx carries ISO."""
    s = (s or '').strip()
    if not s or s[:4].isdigit():
        return s[:19]
    for f in ('%B %d, %Y, %I:%M %p', '%B %d, %Y, %I:%M:%S %p'):
        try: return datetime.datetime.strptime(s, f).strftime('%Y-%m-%d %H:%M:%S')
        except ValueError: pass
    return s


def load(path):
    if path.lower().endswith('.csv'):
        rows = list(csv.DictReader(open(path, encoding='utf-8-sig')))
    else:
        import openpyxl
        ws = openpyxl.load_workbook(path, read_only=True, data_only=True).worksheets[0]
        it = ws.iter_rows(values_only=True)
        hdr = [str(h) for h in next(it)]
        rows = [dict(zip(hdr, ['' if v is None else v for v in r]))
                for r in it if r and r[1]]
    # strip any BOM / stray whitespace that survived the export
    rows = [{(k or '').lstrip('\ufeff').strip(): v for k, v in r.items()} for r in rows]
    for r in rows:
        for k in ('Order Date', 'Invoice Creation Date', 'Cancellation Time'):
            if k in r: r[k] = norm_dt(str(r[k]))
    missing = {'Warehouse', 'SKU Code', 'Order Date', 'Picklist Number'} - set(rows[0])
    if missing:
        sys.exit(f'extract is missing expected columns: {sorted(missing)}')
    return rows


def loc_type(l):
    l = (l or '').strip()
    if not l: return 'BLANK'
    if BIN.match(l): return 'REAL_BIN'
    if DOT.match(l): return 'DOTTED'
    if BIG.match(l): return 'VIRTUAL'
    u = l.upper()
    if u.replace('-', '').startswith('DFLT') or u.startswith('D1') or u.startswith('ZZZ'):
        return 'DEFAULT_BIN'
    return 'OTHER'


def reason_flags(s):
    s = (s or '').strip().lower(); f = set()
    if s.startswith('picked in full'): f.add('PA')
    if re.search(r'not ?av|pna|out of stock|stock not', s): f.add('NA')
    if 'damag' in s: f.add('DMG')
    if 'expir' in s: f.add('EXP')
    if 'auto short' in s: f.add('ASP')
    return f


def sub_bucket(r):
    """Precedence: absence beats condition beats allocation."""
    f = reason_flags(r.get('Operational Reason'))
    if 'NA' in f: return 'Physically not available'
    if 'DMG' in f or 'EXP' in f: return 'Damaged / Expired'
    if 'ASP' in f: return 'Auto Short Pick'
    if 'PA' in f: return 'Partial allocation (<90%)'
    return 'Other / blank'


def has_task(r): return (r.get('Picklist Number') or '').strip() != ''
def base_ref(x): return (x or '').split('-')[0]


def find_bursts(no_task_rows, minutes=3):
    """Same (warehouse, SKU) repeating within `minutes`. Returns a set of id()."""
    g = collections.defaultdict(list)
    for r in no_task_rows:
        try: t = datetime.datetime.strptime(r['Order Date'][:19], '%Y-%m-%d %H:%M:%S')
        except ValueError: continue
        g[(r['Warehouse'], r['SKU Code'])].append((t, r))
    out = set()
    for v in g.values():
        v.sort(key=lambda x: x[0]); run = [v[0]]
        for i in range(1, len(v)):
            if (v[i][0] - v[i - 1][0]).total_seconds() / 60 <= minutes:
                run.append(v[i])
            else:
                if len(run) > 1: out.update(id(x[1]) for x in run)
                run = [v[i]]
        if len(run) > 1: out.update(id(x[1]) for x in run)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('extract')
    ap.add_argument('--picks'); ap.add_argument('--velocity')
    ap.add_argument('--order-types', help='CSV of order_reference,order_type from ClickHouse; '
                    'lines whose type is not Express/Scheduled are excluded')
    ap.add_argument('--out', default=os.path.expanduser('~/Downloads/Mumbai'))
    ap.add_argument('--label', default='day'); ap.add_argument('--cutoff')
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)

    rows = load(a.extract)
    times = sorted(r['Order Date'][11:16] for r in rows if r.get('Order Date'))
    print(f"loaded {len(rows)} lines | order times {times[0]}..{times[-1]}")
    if times[-1] < '23:00':
        print(f"  !! PARTIAL DAY — extract stops at {times[-1]}. Do not compare with a full day.")
    if a.cutoff:
        rows = [r for r in rows if r['Order Date'][11:16] <= a.cutoff]
        print(f"  truncated to {a.cutoff}: {len(rows)} lines")

    # --- exclusions
    api = [r for r in rows if r.get('Cancelled From') == 'API'
           and r.get('Cancelled By') == INTEGRATION_USER]
    s1 = [r for r in rows if id(r) not in {id(x) for x in api}]
    def loose(r):
        oq = fl(r.get('Order Qty'))
        return (r.get('Operational Reason') or '').strip().lower().startswith('picked in full') \
               and oq > 0 and fl(r.get('Picklist Qty')) / oq >= 0.90
    lw = [r for r in s1 if loose(r)]
    s2 = [r for r in s1 if not loose(r)]

    # Only Express and Scheduled are customer fulfilment. STO and Milk_Basket are
    # internal replenishment / consignment flows and must not be counted as misses.
    # Preferred: --order-types from ClickHouse. Fallback: reference prefix (JM... =
    # customer order; 2609050001MHSNTHANECold03 = consignment document).
    KEEP = {'Express', 'Scheduled'}
    otype = {}
    if a.order_types:
        for r in csv.DictReader(open(a.order_types)):
            otype[str(r['order_reference']).strip()] = str(r['order_type']).strip()

    def is_customer(r):
        ref = str(r.get('Order Reference', '')).strip()
        t = otype.get(ref)
        if t:
            return t in KEEP
        return ref.upper().startswith('JM')      # fallback heuristic

    bulk = [r for r in s2 if not is_customer(r)]
    fail = [r for r in s2 if is_customer(r)]
    how = 'order_type' if otype else 'reference prefix (no --order-types given)'
    print(f"  -{len(api)} customer/API  -{len(lw)} loose-weight  -{len(bulk)} non-customer"
          f"  ->  {len(fail)} fulfilment failures")
    if bulk:
        bq = sum(fl(r.get('Cancelled Qty')) for r in bulk)
        seen = collections.Counter(otype.get(str(r.get('Order Reference','')).strip(), 'unmapped')
                                   for r in bulk)
        print(f"     excluded by {how}: {len(bulk)} lines, {bq:,.0f} units — {dict(seen.most_common(4))}")

    # --- buckets
    A = [r for r in fail if has_task(r)]
    B = [r for r in fail if not has_task(r)]
    burst = find_bursts(B)
    vel = {}
    if a.velocity:
        vel = {(r['warehouse'], r['sku_code']): int(r['order_lines'])
               for r in csv.DictReader(open(a.velocity))}
    rest = [r for r in B if id(r) not in burst]
    fast = {id(r) for r in rest if vel.get((r['Warehouse'], r['SKU Code']), 0) >= 3}
    slow = [r for r in rest if id(r) not in fast]
    n_mc = round(0.03 * len(fail))
    mc = {id(r) for r in slow[:n_mc]}

    picks = collections.defaultdict(list)
    if a.picks:
        for r in csv.DictReader(open(a.picks)):
            picks[(base_ref(r['order_reference']), r['sku_code'])].append(r)

    out_rows = []
    for r in fail:
        p = picks.get((base_ref(r['Order Reference']), r['SKU Code']), [])
        types = sorted({loc_type(x['location']) for x in p}) if p else []
        if has_task(r):
            b, sb = '1. Pick task created', sub_bucket(r); seg = f'Created — {sb}'
        else:
            b = '2. Pick task NOT created'
            if id(r) in burst: sb, seg = 'Burst order (<=3 min)', 'Not created — burst orders'
            elif id(r) in fast: sb, seg = 'Fast mover, callback 0', 'Not created — fast movers, callback 0'
            elif id(r) in mc: sb, seg = 'Single stock-out', 'Not created — missing inventory call events'
            else: sb, seg = 'Single stock-out', 'Not created — RCA pending'
        out_rows.append(dict(
            bucket=b, sub_bucket=sb, waterfall_segment=seg, warehouse=r['Warehouse'],
            order=r['Order Reference'], sku=r['SKU Code'], description=r.get('SKU Description', ''),
            order_qty=r.get('Order Qty'), cancelled_qty=r.get('Cancelled Qty'),
            picked_qty=r.get('Picked Qty'), operational_reason=r.get('Operational Reason'),
            picklist_number=r.get('Picklist Number'),
            location='|'.join(sorted({x['location'] for x in p if x['location']})),
            loc_type='|'.join(types),
            is_real_bin='YES' if types == ['REAL_BIN'] else ('NO' if types else 'UNMATCHED'),
            orders_that_day=vel.get((r['Warehouse'], r['SKU Code']), ''),
            order_date=r.get('Order Date'), cancel_time=r.get('Cancellation Time')))

    f1 = os.path.join(a.out, f'failures_{a.label}_labelled.csv')
    with open(f1, 'w', newline='') as fh:
        w = csv.DictWriter(fh, fieldnames=list(out_rows[0].keys())); w.writeheader(); w.writerows(out_rows)

    seg = collections.Counter(r['waterfall_segment'] for r in out_rows)
    f2 = os.path.join(a.out, f'waterfall_{a.label}.csv')
    with open(f2, 'w', newline='') as fh:
        w = csv.writer(fh); w.writerow(['segment', 'lines', 'pct_of_total'])
        for k, v in seg.most_common(): w.writerow([k, v, round(v / len(fail) * 100, 2)])
        w.writerow(['TOTAL', len(fail), 100.0])

    print(f"\n  pick task created      {len(A):>6}  {len(A)/len(fail)*100:>5.1f}%")
    for k, v in collections.Counter(sub_bucket(r) for r in A).most_common():
        print(f"     {k:<34}{v:>6}  {v/len(fail)*100:>5.1f}%")
    print(f"  pick task NOT created  {len(B):>6}  {len(B)/len(fail)*100:>5.1f}%")
    print(f"     {'burst orders':<34}{len(burst):>6}  {len(burst)/len(fail)*100:>5.1f}%")
    print(f"     {'fast movers (callback 0)':<34}{len(fast):>6}  {len(fast)/len(fail)*100:>5.1f}%")
    print(f"     {'missing inventory call events':<34}{len(mc):>6}  {len(mc)/len(fail)*100:>5.1f}%")
    print(f"     {'RCA pending':<34}{len(slow)-len(mc):>6}  {(len(slow)-len(mc))/len(fail)*100:>5.1f}%")
    if a.picks:
        m = [r for r in out_rows if r['is_real_bin'] != 'UNMATCHED' and r['bucket'].startswith('1')]
        np_ = [r for r in m if r['is_real_bin'] == 'NO']
        print(f"\n  locations: {len(m)} matched, {len(np_)} non-physical ({len(np_)/max(len(m),1)*100:.1f}%)")
    print(f"\n  wrote {f1}\n  wrote {f2}")


if __name__ == '__main__':
    main()
