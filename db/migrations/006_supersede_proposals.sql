-- Pending proposals from older investigations of a ticket are hidden once a newer investigation exists.
UPDATE knowledge_proposals p SET status = 'superseded', decided_at = now(), decided_by = 'newer investigation #' || newer.id
  FROM investigations old,
       LATERAL (SELECT max(n.id) AS id FROM investigations n WHERE n.ticket_id = old.ticket_id AND n.id > old.id) newer
 WHERE p.investigation_id = old.id AND p.status = 'pending' AND newer.id IS NOT NULL;
