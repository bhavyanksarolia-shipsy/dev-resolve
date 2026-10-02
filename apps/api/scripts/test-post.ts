// Test: post a message to a ticket's INTERNAL discussion via the same function the Approve route uses,
// resolving the ticket exactly like the route does (investigations.ticket_id). No DB state is changed.
import { Client } from "pg";
import { postInternalComment, listTimeline } from "../src/lib/devrev";

async function main() {
  const [invId, message] = [process.argv[2], process.argv[3]];
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const { rows } = await db.query("SELECT ticket_id, ticket_display FROM investigations WHERE id=$1", [invId]);
  await db.end();
  if (!rows[0]) throw new Error(`investigation ${invId} not found`);
  const { ticket_id, ticket_display } = rows[0];
  console.log(`target: ${ticket_display} (${ticket_id})`);
  const comments = await listTimeline(ticket_id);
  if (message === "--verify-only") {
    for (const c of comments.slice(-3)) console.log(`${c.created_date} ${c.visibility} ${c.created_by?.display_name}: ${JSON.stringify((c.body || "").slice(0, 60))}`);
    return;
  }
  const entry = await postInternalComment(ticket_id, message);
  console.log(`posted: ${entry.id} visibility=${entry.visibility}`);
  const back = (await listTimeline(ticket_id)).find((e) => e.id === entry.id);
  console.log(`read back from ${ticket_display}: ${back ? `found, visibility=${back.visibility}, body=${JSON.stringify(back.body)}` : "NOT FOUND"}`);
}
main().catch((e) => { console.error(e.message || e); process.exit(1); });
