# Reliance VF — glossary

| Term / ID | Meaning | Source |
|---|---|---|
| DevRev account | `[WMS] Reliance -VF` (ACC-CGco7KEf) | DevRev |
| Customer email domain | `qwik.co.in` (DC transport/ops teams) | DevRev tickets |
| DC codes | 4-char site codes, e.g. `FREF` (Chennai SBDC), `FRIA` (Patna SBDC), `R802`, `SB54`, `R468` | Ticket bodies |
| `SD39000234`-style | Customer calls this "Trip No". **Unverified:** whether this is a WMS trip/manifest id or SAP shipment id — confirm against VF DB on first ticket | Ticket bodies |
| `DF00007552`-style | Customer calls this "Delivery No" (SAP outbound delivery) | Ticket bodies |
| `SD64...` | RIL service-desk call number (customer's internal ticket), not a WMS id | Ticket bodies |
| PGI | Post Goods Issue — SAP step after loading; vehicle can't be dispatched until it succeeds | Ticket bodies |


<!-- proposal #1 · investigation #1 · accepted 2026-09-25 -->
| `SD49000021`-style "Trip No" | **Verified:** SAP shipment number = WMS loading/manifest reference. Stored as `LOADING_SESSION.reference_number`, `LOADING_TRUCK_DATA.reference_number` (has vehicle_number), `Manifest_Detail.manifest_reference` (WMS manifest no. e.g. `MF-FRIA-000000021`). Created by `vf_liink_integrations@shipsy.io` | VF DB (TKT-108646) |
| `DF00007552`-style "Delivery No" | **Verified:** `INVOICE_DETAIL.delivery_reference`; WMS invoice no. is `VF000xxxxx` (`INVOICE_DETAIL.invoice_number`) | VF DB (TKT-108646) |
| `hostDocNum` / `hostDocDate` / `hostDocTime` | SAP billing/PGI document number + SAP posting date/time, sent back by SAP via Liink `PUT 'Invoice'` with `loading_status: invoice_updated`; stored in `INVOICE_ADDITIONAL_INFO.json_data.invoice_additional_data`. If it's there, SAP PGI has posted | VF DB + audit (TKT-108646) |
| user id 76 | `vf_liink_integrations@shipsy.io` — Liink/SAP integration user; `updated_by_id=76` means SAP-side callback, not a person | VF DB |


<!-- proposal #6 · investigation #2 · accepted 2026-09-25 -->
| `FREF` | warehouse_id **1100** (RRL VF Chennai SBDC). Manifest numbers `MF-FREF-000000xxx` | VF DB (TKT-111328) |
| `SD39...` Trip No | Same as `SD4...`: WMS LOADING_SESSION.reference_number (verified for FREF, e.g. SD39000234 → MF-FREF-000000231) | VF DB (TKT-111328) |
| `sumasree.allu@shipsy.io` | Shipsy support user; shows up in audit doing manual close_manifest retries and manual `PUT 'Invoice'` hostDoc updates | reliance_audit (TKT-111328) |
| "Weight issue" / "NO DATA FOUND" | Error text the DC sees on the SAP/RIL PGI screen, not a WMS message. Neither string is raised in any WMS loading/invoice path for these trips | code + logs (TKT-111328) |
