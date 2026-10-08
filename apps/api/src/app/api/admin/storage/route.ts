import { existsSync, statfsSync } from "node:fs";
import { requireAdmin } from "@/lib/adminGuard";
import { writeEnv } from "@/lib/adminConfig";
import { adminSetting, ROOT } from "@/lib/config";
import { q } from "@/lib/db";
import { storageSummary } from "@/lib/agent/transparency";

/**
 * Admin → Files & extension → Storage: how big the database is and what takes the space, how full the server's disk is,
 * and how fast it grows. Postgres can't see its own disk's size, so the admin enters the plan's database disk size
 * (DB_DISK_LIMIT_GB) to see how full it is.
 */
const LABEL: Record<string, string> = {
  investigation_steps: "Investigation trails", chat_files: "Attached files", investigations: "Investigations (RCAs, status)",
  private_files: "Settings, knowledge & sign-ins", cases: "Resolved cases", knowledge_proposals: "Knowledge proposals",
  ticket_updates: "DevRev updates log", agent_runs: "Agent runs (tokens)", app_sessions: "Sign-in sessions",
};

export async function GET(req: Request) {
  const g = await requireAdmin(req);
  if (g.error) return g.error;
  const [{ db }] = await q<{ db: number }>(`SELECT pg_database_size(current_database())::float AS db`);
  const tables = await q<{ t: string; bytes: number; rows: number }>(
    `SELECT relname AS t, pg_total_relation_size(relid)::float AS bytes, n_live_tup::int AS rows FROM pg_stat_user_tables ORDER BY 2 DESC`);
  const [grow] = await q<{ last30: number; total: number; first: string | null }>(
    `SELECT count(*) FILTER (WHERE created_at > now() - interval '30 days')::int last30, count(*)::int total, min(created_at)::text first FROM investigations`);
  const trail = tables.find((x) => x.t === "investigation_steps")?.bytes ?? 0;
  const files = tables.find((x) => x.t === "chat_files")?.bytes ?? 0;
  const perInvestigation = grow.total ? (trail + files) / grow.total : 0;
  // The server's own disk (container / volume): code copies, the agent's session files, logs.
  const dir = existsSync("/data") ? "/data" : ROOT;
  let disk: { path: string; total: number; free: number } | null = null;
  try { const s = statfsSync(dir); disk = { path: dir, total: s.blocks * s.bsize, free: s.bavail * s.bsize }; } catch { /* not available */ }
  const sessions = (await storageSummary()).find((x) => x.label === "Agent sessions");
  const limitGb = Number(adminSetting("DB_DISK_LIMIT_GB")) || null;
  const top = tables.filter((x) => x.bytes > 0).slice(0, 7);
  const rest = tables.slice(7).reduce((n, x) => n + x.bytes, 0);
  return Response.json({
    db: { bytes: db, limitBytes: limitGb ? limitGb * 1024 ** 3 : null, limitGb },
    parts: [...top.map((x) => ({ key: x.t, label: LABEL[x.t] ?? x.t.replace(/_/g, " "), bytes: x.bytes, rows: x.rows })), ...(rest > 0 ? [{ key: "other", label: "Everything else", bytes: rest, rows: null }] : [])],
    growth: { last30: grow.last30, total: grow.total, since: grow.first, perInvestigation, perMonth: grow.last30 * perInvestigation },
    disk, sessions: sessions ? { files: sessions.count, bytes: sessions.bytes } : null,
  });
}

export async function POST(req: Request) {
  const g = await requireAdmin(req);
  if (g.error) return g.error;
  const b = (await req.json().catch(() => ({}))) as { dbLimitGb?: number | string };
  const v = String(b.dbLimitGb ?? "").trim();
  if (v && !(Number(v) > 0 && Number(v) <= 10_000)) return Response.json({ error: "Enter the database disk size in GB, e.g. 5" }, { status: 400 });
  await writeEnv({ DB_DISK_LIMIT_GB: v || null }, g.user.name);
  return Response.json({ ok: true, message: v ? `Database disk set to ${v} GB` : "Database disk size cleared" });
}
