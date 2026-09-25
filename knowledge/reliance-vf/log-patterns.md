# Reliance VF — log patterns

_No entries yet — filled by accepted proposals._


<!-- proposal #5 · investigation #2 · accepted 2026-09-25 -->
| Log line (reliance_app) | Meaning |
|---|---|
| `Invoice creation failed for manifest=SDxxxxxxxx: [...]` (ERROR) | Loading-based auto invoice failed (close_manifest or scan-driven run). The loading session is reverted to open, and no invoice or PGI goes to SAP. The request_id matches the audit `PUT 'Loading' close_manifest` request |
| `Invoice created for manifest=SDxxxxxxxx, sos_count=N` (INFO) | Invoice generated for the manifest. SAP hostDoc (PGI) normally follows within ~15-60 min |
| `No items met threshold for manifest=SDxxxxxxxx` (INFO) | Scan-driven auto_loading_invoice run skipped the manifest (not an error) |
| `TASK_QUEUE` trigger `auto_loading_invoice`, payload `{"manifest_number": "SD...", "manifest_closure": true}` | One row per close attempt. `reference_number` is '' so filter on payload. Status 3 only means the task ran, **not** that the invoice succeeded |
