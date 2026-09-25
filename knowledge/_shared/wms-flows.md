# WMS-wide facts (all accounts)

_Seed file. Add only facts that hold across every StockOne WMS tenant._

## Investigation order that works
1. Pull every identifier from the ticket (order/delivery/trip/GRN/ASN/LPN numbers, warehouse code, timestamps).
2. Work out **which system** each identifier belongs to (WMS vs SAP vs TMS) before searching — searching the
   wrong system returns "not found", which is not evidence.
3. Logs (app → audit → integration) for the event/error trail around the reported time.
4. DB for the current state of the records.
5. Code: grep the exact error string / status transition to see the real condition.
6. Reconcile into one explanation; say explicitly what could not be verified.

## Tool-failure rule
`VPN_REQUIRED` / `AUTH_FAILED` from any tool = the search did **not** happen. Never report it as "no data".

## Customer replies
Facts and current status only. Never promise or hint at fixes, improvements, product changes or timelines unless the
team has explicitly agreed them. Internal recommendations go in "Fix / next step", never in the customer reply.
