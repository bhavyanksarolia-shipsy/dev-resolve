-- proposal #2 · investigation #1 · accepted 2026-09-25
-- VF: is PGI posted in SAP for a trip / delivery? (replace SD... / DF...)
-- Normal lag between WMS invoice_date and SAP hostDoc time is a few minutes; NULL sap_host_doc = SAP PGI not yet confirmed back.
SELECT l.reference_number AS trip, l.vehicle_number, ls.status AS loading_status, ls.updation_date AS loading_done,
       m.manifest_number, i.invoice_number, i.delivery_reference, i.invoice_date,
       a.json_data->'invoice_additional_data'->>'hostDocNum'  AS sap_host_doc,
       a.json_data->'invoice_additional_data'->>'hostDocDate' AS sap_doc_date,
       a.json_data->'invoice_additional_data'->>'hostDocTime' AS sap_doc_time,
       i.json_data->>'invoice_updated_at' AS last_sap_invoice_update_utc
FROM "LOADING_TRUCK_DATA" l
JOIN "LOADING_SESSION" ls ON ls.reference_number = l.reference_number AND ls.warehouse_id = l.warehouse_id
LEFT JOIN "Manifest_Detail" m ON m.manifest_reference = l.reference_number AND m.warehouse_id = l.warehouse_id
LEFT JOIN "INVOICE_DETAIL" i ON i.invoice_number = m.invoice_reference AND i.warehouse_id = m.warehouse_id
LEFT JOIN "INVOICE_ADDITIONAL_INFO" a ON a.full_invoice_number = i.invoice_number AND a.warehouse_id = i.warehouse_id
WHERE l.reference_number = 'SD49000021'   -- or: i.delivery_reference = 'DF00007552'
LIMIT 20;
