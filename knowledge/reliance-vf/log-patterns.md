# Reliance VF — log patterns

_No entries yet — filled by accepted proposals._


<!-- proposal #5 · investigation #2 · accepted 2026-09-25 -->
| Log line (reliance_app) | Meaning |
|---|---|
| `Invoice creation failed for manifest=SDxxxxxxxx: [...]` (ERROR) | Loading-based auto invoice failed (close_manifest or scan-driven run). The loading session is reverted to open, and no invoice or PGI goes to SAP. The request_id matches the audit `PUT 'Loading' close_manifest` request |
| `Invoice created for manifest=SDxxxxxxxx, sos_count=N` (INFO) | Invoice generated for the manifest. SAP hostDoc (PGI) normally follows within ~15-60 min |
| `No items met threshold for manifest=SDxxxxxxxx` (INFO) | Scan-driven auto_loading_invoice run skipped the manifest (not an error) |
| `TASK_QUEUE` trigger `auto_loading_invoice`, payload `{"manifest_number": "SD...", "manifest_closure": true}` | One row per close attempt. `reference_number` is '' so filter on payload. Status 3 only means the task ran, **not** that the invoice succeeded |


<!-- proposal #7 · investigation #3 · accepted by admin 2026-09-25 -->
| `Invoice Callback data for warehouse <wh_id>, invoice_number VF...` (reliance_app) — **timestamps per invoice** | Normally 2-3 hits per invoice: (1) same request_id as the close_manifest/auto-invoice run (WMS invoice created), (2) ~10s later (SAP delivery_idoc callback), (3) the hostDoc/PGI callback from SAP. The `invoice_updated_at` in the following `Pre-transformation data for topic SHIPSY_WMS_VALUE.INVOICE_HEADER_DETAIL` line = when SAP's PGI confirmation reached WMS. Query `invoice_number VF000xxxxx`, size 5 (TKT-111615: 15:09:35Z, 15:09:45Z, 19:09:18Z) |
| "PGI FOR THE DELIVERIES NOT DONE FOR THE TRIP" | Not a WMS string (no match in stockone-neo). It's the downstream trip-start PGI gate (Shipsy TMS org `reliancevalueformat`, `pgi_invoice_check_delivery_task`) / SAP wording. In WMS check hostDoc via vf_pgi_status_by_trip.sql — if hostDoc posted after the ticket time, it was an SAP PGI lag (TKT-111615) |
