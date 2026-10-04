/**
 * Copy this laptop's Dev Resolve history (investigations with their steps, agent runs, chat files, cases, knowledge
 * proposals, and the Stage / Pod change log) into another Dev Resolve database — e.g. production on Railway.
 *
 *   npm run history -- push "<database URL>"            dry run: shows what would be copied, writes nothing
 *   npm run history -- push "<database URL>" --apply    copies it (one transaction: all or nothing)
 *
 * Use the target's PUBLIC connection URL (Railway → Postgres → Connect → DATABASE_PUBLIC_URL). It is only read from
 * the command line, never stored. Each investigation is ADDED with a new id in the target (its children re-linked),
 * so the target's own history is never touched; anything already copied (same ticket + creation time) is skipped,
 * so running it again is safe.
 */
import { Client } from "pg";
import { pgConfig } from "../src/lib/pgConfig";

type Row = Record<string, unknown>;
const CHILDREN = ["investigation_steps", "agent_runs", "chat_files", "cases", "knowledge_proposals"] as const;

async function main() {
  const [cmd, url, ...rest] = process.argv.slice(2);
  const apply = rest.includes("--apply");
  if (cmd !== "push" || !url) throw new Error('Usage: npm run history -- push "<database URL>" [--apply]');
  if (/\.railway\.internal\b/i.test(url)) throw new Error(
    "That's Railway's INTERNAL address (works only inside Railway). Use DATABASE_PUBLIC_URL from the Postgres service's Variables — " +
    'its host contains "proxy.rlwy.net".');
  if (!/^postgres(ql)?:\/\//i.test(url)) throw new Error(
    "That's not a database address. Use the Postgres one: Railway → the Postgres service → Variables → DATABASE_PUBLIC_URL " +
    '(it starts with "postgresql://" and contains "proxy.rlwy.net") — not the app\'s https:// web address.');

  const src = new Client(pgConfig());
  const dst = new Client({ connectionString: url, ssl: /railway|rlwy|amazonaws|render|neon|supabase/.test(url) ? { rejectUnauthorized: false } : undefined });
  await src.connect();
  await dst.connect();
  try {
    const where = (u: string) => { try { const x = new URL(u); return `${x.hostname}:${x.port || 5432}${x.pathname}`; } catch { return u; } };
    if (where(url) === where(process.env.DATABASE_URL || "")) throw new Error("That's this laptop's own database — give the other database's URL");

    // Columns both sides have (the target may be on a newer / older schema), and which ones hold JSON.
    const cols = async (db: Client, table: string) =>
      // Computed columns (e.g. a full-text "search" vector) are filled in by the database itself — never copied.
      (await db.query<{ column_name: string; data_type: string }>(
        `SELECT column_name, data_type FROM information_schema.columns
          WHERE table_schema = current_schema() AND table_name = $1 AND is_generated <> 'ALWAYS' AND generation_expression IS NULL`, [table])).rows;
    const shared = async (table: string) => {
      const [a, b] = await Promise.all([cols(src, table), cols(dst, table)]);
      const there = new Map(b.map((c) => [c.column_name, c.data_type]));
      return a.filter((c) => c.column_name !== "id" && there.has(c.column_name)).map((c) => ({ name: c.column_name, json: /json/.test(there.get(c.column_name)!) }));
    };
    const insert = async (table: string, columns: { name: string; json: boolean }[], row: Row, returning = false) => {
      const names = columns.map((c) => `"${c.name}"`).join(", ");
      const params = columns.map((c) => (c.json && row[c.name] != null ? JSON.stringify(row[c.name]) : row[c.name]));
      const r = await dst.query(`INSERT INTO ${table} (${names}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(", ")})${returning ? " RETURNING id" : ""}`, params);
      return returning ? (r.rows[0].id as number) : 0;
    };
    // Many rows in one statement (100 at a time): one network round trip instead of one per row.
    const insertMany = async (table: string, columns: { name: string; json: boolean }[], rows: Row[]) => {
      const names = columns.map((c) => `"${c.name}"`).join(", ");
      for (let i = 0; i < rows.length; i += 100) {
        const chunk = rows.slice(i, i + 100), params: unknown[] = [];
        const values = chunk.map((row) => `(${columns.map((c) => {
          params.push(c.json && row[c.name] != null ? JSON.stringify(row[c.name]) : row[c.name]);
          return `$${params.length}`;
        }).join(", ")})`).join(", ");
        await dst.query(`INSERT INTO ${table} (${names}) VALUES ${values}`, params);
      }
    };

    // Investigations still running on this laptop are left out (they'd be copied half-done).
    const invs = (await src.query<Row>(`SELECT * FROM investigations WHERE status <> 'running' ORDER BY id`)).rows;
    const already = new Set((await dst.query<{ k: string }>(`SELECT ticket_display || '|' || created_at::text AS k FROM investigations`)).rows.map((r) => r.k));
    const key = async (r: Row) => (await src.query<{ k: string }>(`SELECT $1::text || '|' || $2::timestamptz::text AS k`, [r.ticket_display, r.created_at])).rows[0].k;
    const todo: Row[] = [];
    for (const r of invs) if (!already.has(await key(r))) todo.push(r);

    const childCount: Record<string, number> = {};
    const ids = todo.map((r) => r.id);
    for (const t of CHILDREN) childCount[t] = ids.length ? (await src.query<{ n: number }>(`SELECT count(*)::int n FROM ${t} WHERE investigation_id = ANY($1)`, [ids])).rows[0].n : 0;
    const updates = (await src.query<Row>(`SELECT * FROM ticket_updates ORDER BY id`)).rows;
    const updKeys = new Set((await dst.query<{ k: string }>(`SELECT ticket || '|' || created_at::text AS k FROM ticket_updates`)).rows.map((r) => r.k));
    const updTodo: Row[] = [];
    for (const u of updates) {
      const k = (await src.query<{ k: string }>(`SELECT $1::text || '|' || $2::timestamptz::text AS k`, [u.ticket, u.created_at])).rows[0].k;
      if (!updKeys.has(k)) updTodo.push(u);
    }

    console.log(`Investigations: ${todo.length} to copy, ${invs.length - todo.length} already there${(await src.query(`SELECT 1 FROM investigations WHERE status='running'`)).rowCount ? " (running ones left out)" : ""}`);
    for (const t of CHILDREN) console.log(`  ${t}: ${childCount[t]}`);
    console.log(`Stage / Pod change log: ${updTodo.length} to copy, ${updates.length - updTodo.length} already there`);
    if (!apply) { console.log("\nDry run — nothing written. Add --apply to copy."); return; }
    if (!todo.length && !updTodo.length) { console.log("\nNothing to copy."); return; }

    const invCols = await shared("investigations");
    const childCols: Record<string, Awaited<ReturnType<typeof shared>>> = {};
    for (const t of CHILDREN) childCols[t] = await shared(t); // one query at a time per connection
    const updCols = await shared("ticket_updates");
    console.log("\nCopying (nothing is saved until the end — stopping now leaves the target unchanged)…");
    await dst.query("BEGIN");
    try {
      let done = 0;
      for (const inv of todo) {
        // The agent's chat session lives on this laptop; without it the target re-seeds a chat from the ticket + RCA.
        const newId = await insert("investigations", invCols, { ...inv, session_id: null }, true);
        for (const t of CHILDREN) {
          const rows = (await src.query<Row>(`SELECT * FROM ${t} WHERE investigation_id = $1 ORDER BY id`, [inv.id])).rows;
          await insertMany(t, childCols[t], rows.map((row) => ({ ...row, investigation_id: newId })));
        }
        console.log(`  ${++done}/${todo.length}  ${inv.ticket_display} (#${inv.id} → #${newId})`);
      }
      await insertMany("ticket_updates", updCols, updTodo);
      console.log("Saving…");
      await dst.query("COMMIT");
    } catch (e) {
      await dst.query("ROLLBACK");
      throw e;
    }
    console.log(`\nCopied ${todo.length} investigation(s) and ${updTodo.length} change-log row(s). Reload the dashboard to see them.`);
  } finally {
    await src.end();
    await dst.end();
  }
}

main().catch((e) => { console.error(`history: ${(e as Error).message}`); process.exit(1); });
