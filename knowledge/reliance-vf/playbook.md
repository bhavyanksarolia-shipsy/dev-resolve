# Reliance VF — playbook

## Connections
- Logs: `reliance_app` (app), `reliance_audit` (audit / who-did-what), `reliance_link` (SAP/ERP integration middleware)
- DB: Metabase `--project wms --database 2` (Postgres replica), `--database 3` (Mongo)
- Code: `stockone-neo` (`stockone-wms/wms/...`)

## Issue category: PGI failure / vehicle held at DC  _(most frequent VF category, Sep 2026)_
Observed pattern: DC reports loading complete but PGI fails ("Weight issue", "NO DATA FOUND", "PGI idoc stuck
due to deficit"), vehicle held.

**Known miss to avoid:** DevRev's Friday bot investigated these in Shipsy TMS (projectx/qwiklogistics) logs, found
no hits, and concluded "outside our observability" at 5/10 confidence (TKT-108646, TKT-111328). These are StockOne
WMS VF flows — search `reliance_link` + `reliance_app` and the VF DB instead.

First checks (**Unverified** — confirm and refine on the first investigated ticket):
1. `reliance_link` logs for the delivery/trip number around the reported time → SAP request/response + error text.
2. `reliance_app` logs for the same identifier at ERROR/WARNING level.
3. VF DB: find the delivery/trip/manifest record and its status; check stock/deficit for "deficit"-type errors.
4. Code: grep the exact SAP/WMS error string in `stockone-neo` to find where it's raised and the condition.


<!-- proposal #3 · investigation #1 · accepted 2026-09-25 -->
## PGI failure / vehicle held — verified flow (TKT-108646)
1. Liink creates loading session + truck data for SAP shipment (`SD4...`) → DC loads → WMS invoice `VF...` generated at loading completion.
2. SAP sends back via Liink two `PUT 'Invoice'` calls (audit, user `vf_liink_integrations@shipsy.io`): (a) `invoice_additional_data.delivery_idoc`, (b) `idoc` + `hostDocNum/hostDocDate/hostDocTime` + `loading_status: invoice_updated` = PGI/billing posted in SAP.
3. (b) triggers WMS `invoice_updation` webhook → app log `Invoice Callback data for warehouse <id>, invoice_number VF...` followed by `Produced event to SHIPSY_WMS_VALUE.INVOICE_HEADER_DETAIL` per LPN.
- Run `queries/vf_pgi_status_by_trip.sql`. If WMS invoice exists but hostDoc is NULL or hostDocDate is far after invoice_date → SAP-side PGI delay (route to RIL SAP/Liink team), not WMS.
- Log caveats: `reliance_link` entries come back with an empty message/body through the tool, so body search there doesn't work. `reliance_audit` retention is short (13-Sep records were gone by 25-Sep), so check audit early. App logs are kept at least 17 days. When grepping app logs, use a request_id + a narrow phrase and size ≤5, because the lines are huge.


<!-- proposal #4 · investigation #2 · accepted 2026-09-25 -->
## PGI "NO DATA FOUND" / "Weight issue" after loading — check WMS invoice-on-close FIRST (TKT-111328)
The DC sees "Manifest closed successfully", but WMS invoice creation can fail in the background. When it does, WMS silently sets the loading session back to **status 1 (open)**, so no invoice goes to SAP and PGI fails.
1. Audit: `reliance_audit` wh=<DC>, request_contains=<SD trip> → `PUT 'Loading' request_type close_manifest` calls. Several close attempts on the same trip is the tell.
2. App: `reliance_app` query `Invoice creation failed for manifest=<SD trip>` (ERROR). The error text is the root cause (e.g. `Invoice for Excess Quantity Not Allowed ...`, `Please select all items in LPN <LPN>`). Success line: `Invoice created for manifest=<SD trip>, sos_count=N`.
3. DB: `LOADING_SESSION.status` (5 = closed/invoiced, 1 = reverted open) + `vf_pgi_status_by_trip.sql`.
4. Code: `outbound/views/manifest/loading.py` ~L630-665 (on failure → LoadingSessionItem status 1, LoadingSession 5→1, ManifestDetail status 1). Validations are in `outbound/views/invoice/create_invoice.py` L954 (excess qty vs order open qty) and L1231 (full-LPN packing).
5. Excess-qty failures clear once SAP's Liink `PUT 'Sale Orders'` (status update) brings the order qty back in line with the loaded qty, then someone retries the close.
