---
name: ffo-miss-analysis
description: FFO miss analysis for RIL-QC (JioMart) quick commerce — why order lines were cut. Covers the day-level RCA (exclusions, two-bucket model, waterfall, day-over-day trend), single-order diagnosis (was a pick task created, and what inventory callback preceded the order), and evidence-based classification of allocation misses. Use for any "cancel — line level detail" extract, any question about short picks / misses / cut lines / burst orders / stale availability, or when reconciling our miss % against the client's.
---

# FFO miss analysis

Derived and validated on 1–6 Sep 2026 (≈95k raw cancelled lines, ~730 stores). Everything below
is measured, not assumed. Where a conclusion was later overturned it is marked, because the
overturns are the most useful part.

## The one question that structures everything

**Was a pick task created?** It splits misses into two populations with different owners, different
diagnostics and different fixes. Answer it before anything else.

```
                        cut order line
                              |
                 was a pick task created?
              /                              \
            YES (~78-93%)                    NO (~6-22%)
   failure ON THE FLOOR                failure BEFORE THE FLOOR
   picker went, couldn't finish        nothing could be allocated
            |                                     |
   read the pick row:                  read the inventory callback:
   reason + location                   what did we publish, and when?
```

## Scripts

| Script | Use |
|---|---|
| `scripts/day_rca.py` | A whole trading day -> buckets, waterfall, labelled CSV |
| `scripts/trace_order.py` | One order reference -> per-line verdict + callback history |
| `scripts/b2_classify.py` | Trace every Bucket-2 pair in a day and classify by evidence |

```sh
python3 scripts/day_rca.py <extract.csv|xlsx> --picks picks.csv --velocity vel.csv \
        --order-types order_types.csv --label 06Sep        # outputs to ~/Downloads/Mumbai
python3 scripts/trace_order.py JM6A9D0E2501335F9463-01
python3 scripts/b2_classify.py --input <labelled_failures.csv> --out b2_traces.json
```

`b2_classify.py` was a hardcoded one-off (`CLAUDE_JOB_DIR` env var + a literal
`failures_06Sep_labelled.csv`) until 2026-09-12 — now a normal `--input`/`--out` CLI.
The `--input` CSV needs `bucket`, `warehouse`, `sku`, `order_date` columns (exactly
what `day_rca.py --label ...` produces); only rows whose `bucket` starts with `2`
are traced.

Needs the RIL VPN. ClickHouse auth comes from the `reliance-metabase-query` skill's stored
session (`--project wms`, database 5 = QC ClickHouse PROD). **Correction 2026-09-12:**
OpenSearch is NOT anonymous from this machine — confirmed via direct test (401 with no
auth, 400 "must contain osd-xsrf" with Basic Auth alone, 200 once the header was added
too). `trace_order.py`/`b2_classify.py` now fall back to `Dev Resolve's config/ folder config.env`'s
`RELIANCE_OS_USERNAME`/`RELIANCE_OS_PASSWORD` automatically if `OS_USER`/`OS_PASS` aren't
set. Inputs and outputs live in `~/Downloads/Mumbai/`.

## Step 1 — get to a real denominator

Three exclusions, in order. Report the line count at every stage or the numbers cannot be read
coherently — that was a real complaint.

| Exclusion | Rule | Typical size (of raw) |
|---|---|---|
| Customer / API cancellations | `Cancelled From = API` and `Cancelled By = rildsintegrationuser@shipsy.io` | **~60-85%** |
| Loose-weight rounding | reason starts "picked in full" **and** `Picklist Qty / Order Qty >= 0.90` | ~400-560 lines |
| Non-customer order types | keep **only `Express` + `Scheduled`**; drop `STO`, `Milk_Basket`, `CDFT` | 21 -> 404 lines/day, rising |

**Order type must come from ClickHouse `fact_order_lines.order_type`**, passed via `--order-types`.
The reference-prefix fallback (`JM…` = customer) is a proxy only. Milk_Basket cancellations grew
21 -> 403 lines in five days and at their peak were **53% of all cancelled units** — a single
midnight dairy consignment at T57C (refs like `2609050001MHSNTHANECold03`, up to 132 units/line)
read as 110 customer "burst orders" until this filter was added.

A worked funnel (6 Sep):

```
raw cancelled lines                                 15,529   (5,214 orders)
  less customer / API                              -13,119
  less loose-weight >=90% + STO/Milk_Basket           -541
= FULFILMENT FAILURES                                1,869   (1,684 orders)
    Bucket 1 · pick task created                     1,458   (1,304 orders)
    Bucket 2 · pick task NEVER created                 411     (386 orders)
       of which burst                                  264     (248 orders)
       of which non-burst                               147     (139 orders)
```

## Step 2 — Bucket 1: the pick was raised and failed

Sub-bucket on `Operational Reason`, precedence **Not-Available > Damaged/Expired > Auto Short Pick
> Partial allocation**. Typically 64-81% of all failures are "physically not available".

**Read the location, because one error code hides two problems.** Only `^\d{3}-\d+-\d+$` is a
physical bin (user-confirmed; dotted `XXX.X.X` is **not**).

- `Not Available` at `315-4-5` -> the shelf is real, **the stock record is wrong** -> cycle count
- `Not Available` at `DFLT-1`, `DFLT1`, `ZZZ-*`, `1000-X-X` -> **there is no shelf**; goods were
  received and never put away -> fix putaway

The non-physical rate ran 12.7% -> 5.9% over the six days. **It is a diagnostic inside Bucket 1,
not a headline KPI** — don't put it in the top-line table.

**Velocity is not a Bucket-1 diagnostic.** Bucket 1 is ~91% slow movers, but the pick task existed
and a picker was dispatched, so velocity describes the assortment, not the fault. Only classify
fast/slow inside Bucket 2 — and even there see the warning in Step 3.

## Step 3 — Bucket 2: no pick task was created

`line_status 3`, `allocated 0`, `open 0`, full quantity cancelled. No bin, no picker, no reason
code — which is exactly why these look empty in operational reporting. The only evidence is the
last `ABS/UPDATE` callback published before the order arrived.

### Split burst out first

**Burst = same (warehouse, SKU) repeating within 3 minutes.** Chain consecutive orders, keep runs
of 2+. Grew 100 -> 264 lines (78 -> 248 orders) over the six days; 1.5% -> 14.1% of all failures.
Analyse everything else separately — burst has its own thesis and swamps the rest.

### Then classify the remainder by what was actually published

**Do not classify by velocity.** Median velocity is 5-6 across *every* evidence class, so it
separates nothing. A velocity-assigned label ("fast mover, callback 0") turned out wrong on 65%
of its lines — 31% had published a *positive* quantity.

The two tests that matter, applied to the non-burst remainder (147 lines on 6 Sep):

**Test A — did the order exceed what we published?**

```
order qty  >  published :   0 lines
order qty  <= published :  51 lines
```

**Customers were not over-ordering — not one cut line asked for more than we advertised.** Worth
running every time, because it is the obvious client rebuttal and on this data it does not hold.

**Test B — what did the last callback say?**

| Outcome | 6 Sep | Owner |
|---|---|---|
| We published **0** | 92 (63%) | see below |
| We published **>0** and the order was within it | **51 (35%)** | **ours — allocation defect** |
| No callback found in 12 days | 4 | unknown |

Of the 51: **reserved = 0 on 96%**, `total >= published` on 98%, and **53% of callbacks were under
an hour old** (many under 5 minutes). So the stock was present, free, freshly published — and
allocation still refused it. Examples: FR7F published **53** units 35 min before an order for 2;
U1QT published **48** 2 min before an order for 2. **This is the least-understood finding and the
one to escalate.** Staleness explains only 20 of 147 lines.

Of the 92 where we published 0: ~58% had `total 0` (**genuine stock-out — theirs**, we published
zero promptly and the order was accepted anyway); the rest had stock that was reserved or held.

## Step 4 — reconciling against the client's number

The client pivots `Count of SKU Description` and `Sum of Cancelled Qty` by `Cancellation Status`
and reports **No Allocation + Partial Allocation as a share of cancelled QUANTITY**.

```
client headline (NoAlloc + PartAlloc, by QUANTITY)   12.29%
  less Partial Allocation — a pick task DID exist    -3.51pp
= No Allocation only, by quantity                     8.78%
  switch quantity -> lines                           -1.38pp
= No Allocation only, by LINES                        7.40%   <- comparable to ours
```

Two definitional gaps, and the smaller one is the one people reach for first:

1. **Partial Allocation belongs with Short Pick, not with No Allocation.** All 182 lines carried a
   **picklist number** — the pick task was created and executed. 58% were allocated >=90% (mean
   shortfall 0.24 units, 100% fractional, 97% `LOOSE`/per-kg) — i.e. loose-weight rounding.
2. **Quantity vs lines is worth only ~1.4pp.** Report lines or orders; quantity lets a 0.078-unit
   rounding remainder weigh the same as a whole missing item.

**Data agreed exactly** — No Allocation 234=234, Partial Allocation 182=182. There was never a
data gap, only a definition gap. Confirm that before arguing about the number.

**Agree which question is being answered.** "How often did the customer not get what they ordered?"
legitimately includes Partial Allocation. "How often did pick task creation fail?" does not.

## Benchmarks (Express + Scheduled, full days)

| | 1 Sep | 2 Sep | 3 Sep | 4 Sep | 5 Sep | 6 Sep |
|---|---|---|---|---|---|---|
| Fulfilment failures | 6,879 | 5,598 | 3,354 | 2,887 | 1,923 | 1,869 |
| Pick task NOT created | 10.9% | 11.9% | 6.4% | 8.4% | 15.3% | **22.0%** |
| — burst | 1.5% | 1.8% | 1.8% | 2.4% | 9.1% | **14.1%** |
| Physically not available | 78.7% | 76.1% | 81.0% | 78.1% | 67.6% | 63.7% |
| Non-physical bin rate | 12.7% | 10.7% | 9.1% | 8.3% | 7.0% | 5.9% |
| Free-text reason lines | 16 | 7 | 75 | 47 | 83 | 50 |

Volume fell 73% while **Bucket 2 doubled as a share** — the shop floor improved, availability did
not. Recurring stores: **TBDT, 2164, TM8Q, U280, TK5W, TD9R, TK4Z, T7GZ**. Recurring categories:
large-format haircare/soap and ghee, usually at 1-2 units depth.

## Reading the callback log

Index `app-logs-*ril-qc-prod`, `filename: stream.py`. Match store code **and** SKU inside `message`
— the top-level `warehouse` field is almost always `unknown`. Only `funcname` and `company_code`
have `.keyword`; everything else needs `match_phrase` (a `term` query silently returns zero).

| Signature | Means |
|---|---|
| `published 0`, `total 0` | genuine stock-out |
| `published 0`, `reserved = total` | last-unit race |
| `published 0`, `total > 1`, `reserved 0` | **availability lock** — stock on the shelf, withheld |
| `published > 0`, callback fresh | **allocation defect** (see Step 3) |
| `published > 0`, callback hours old | stale positive feed |

**`type: ABS / event: UPDATE` is availability. `type: INCR / event: GRIN` is a goods-receipt
notification and does NOT change availability** — don't read a GRIN quantity as stock offered.
Both ride the same `grocery_mdh_feed` topic.

## Traps that cost real time

- **One streamed event writes ~3 log lines.** The pre-transformation payload carries
  `total_quantity`/`reserved_quantity`; the Kafka payload carries the published `quantity`. They
  share a `request_id` — **merge on it**, or total and published land on separate rows.
- **OPEN BUG:** on a **multi-SKU batch** payload a bare regex for `total_quantity` returns the
  *first* article's value, i.e. another SKU's numbers. `b2_classify.py` now only reads them when
  the message carries a single `'article':` and returns `None` otherwise. **This invalidated a
  "25 lines locked out" claim** — hand-tracing showed all three sampled cases were last-unit
  races with `reserved = total = 1`. A lock can only be asserted when `total > 1` and
  `reserved = 0`. Fix properly by parsing the payload per article before trusting any per-class count.
- **No implicit date filter, and the index spans weeks.** Always range-filter and compare **full
  datetimes**. Comparing time-of-day made a 2-day-old callback look 6 hours old and understated
  median staleness by 8x (6h -> 48.7h).
- `stream_lookup.py sku` has no date filter and returns the last N events across all days; a
  high-velocity SKU overflows the window, so bound it.
- Timestamps in logs are **UTC**; convert to IST (+05:30) before comparing with order times.
- **Check the extract is a full day** (`Order Date` max ~23:59). A pull at 21:59 stops at 21:55 and
  understates the day ~10%. Never compare a partial day with a full one.
- **CSV exports carry minute-precision timestamps** (`September 2, 2026, 11:05 PM`) while xlsx
  carries real seconds. Sub-minute burst gaps are not readable from CSV days.
- Some CSVs carry a **UTF-8 BOM** on the first header — read with `encoding='utf-8-sig'`.
- **Check the export's scope before comparing days**: a normal extract is ~60-85%
  `Manual / API Cancellation`. One 3 Sep pull came through at 7.4% because customer cancellations
  had been filtered upstream; raw counts were not comparable. Cross-check volumes against ClickHouse.
- `Operational Reason` is **free text and mislabelled**. Thousands of lines read "Picked in full –
  remainder never allocated" with `Picked Qty = 0` against a *complete* picklist (nothing was
  picked; the customer cancelled). Pickers also type `store`, `na`, `n/a`, `error` — 16 -> 190
  lines over the week, concentrated at TN1Q and U1UO. Always cross-check `Picked Qty` and
  `Cancelled By`.
- Store `U1RU` is absent from ClickHouse entirely. Store `2935` exists in the master but has never
  traded on this platform. Exclude and say so.
- Dedup `fact_picks` on `picklist_id`, `fact_order_lines` on `order_detail_id`, by
  `max_updation_date`. `mb.py` prints only the first 100 rows — use the CSV export for real pulls.
- zsh does not word-split unquoted vars — use `${=args}` when building CLI args in a loop.

## Method discipline (the lesson that cost the most)

**Never generalise from hand-picked traces.** Twice, a confident conclusion from a handful of
chosen SKUs was overturned by a random sample of the same population:

1. Hand-picked repeats and fast movers all showed a correct published `0`. A random 10 from the
   same bucket showed a **stale positive 10 times out of 10** (median 48.7h).
2. Two stores traced by hand (2164, 3062) showed a textbook last-unit race with one-unit restocks.
   Tracing **all 190 pairs** showed only **3%** of the 264-line burst bucket was a last-unit race;
   48% was a stale positive.

Sample randomly, size the population, and re-state the conclusion against the population — not
against the examples that prompted the hypothesis.

## Related skills

`ril-qc-stream-lookup` (raw inventory-stream lookup, `trace` mode for a full request chain —
**not installed on this machine as of 2026-09-12**) ·
`reliance-metabase-query` (ClickHouse/Postgres access and credentials; was named
`metabase-query`, renamed 2026-09-11 — see that skill's own docs).
