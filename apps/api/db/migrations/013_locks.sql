-- At most one running investigation per ticket (two people / a double click can't start two).
-- Older duplicates (if any) are closed first so the index can be created.
UPDATE investigations i SET status = 'failed', error = 'Superseded: another investigation of this ticket was running', finished_at = now()
 WHERE status = 'running' AND EXISTS (SELECT 1 FROM investigations j WHERE j.ticket_display = i.ticket_display AND j.status = 'running' AND j.id > i.id);
CREATE UNIQUE INDEX IF NOT EXISTS investigations_one_running_per_ticket ON investigations (ticket_display) WHERE status = 'running';
