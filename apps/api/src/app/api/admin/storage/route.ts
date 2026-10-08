import { execFile } from "node:child_process";
import { existsSync, statfsSync, statSync } from "node:fs";
import path from "node:path";
import { requireAdmin } from "@/lib/adminGuard";
import { writeEnv } from "@/lib/adminConfig";
import { adminSetting, CODE_ROOT, ROOT } from "@/lib/config";
import { q } from "@/lib/db";
import { storageSummary } from "@/lib/agent/transparency";

/**
 * Admin → Files & extension → Storage: how big the database is and what takes the space, how full the server's disk is,
 * and how fast it grows. Postgres can't see its own disk's size, so the admin enters it (DB_DISK_LIMIT_MB — e.g. 500 on
 * Railway's trial). "Used" = every database on that Postgres + its change log (WAL); the host's own page may show a little
 * more (file-system overhead).
 */
const LABEL: Record<string, string> = {
  investigation_steps: "Investigation trails", chat_files: "Attached files", investigations: "Investigations (RCAs, status)",
  private_files: "Settings, knowledge & sign-ins", cases: "Resolved cases", knowledge_proposals: "Knowledge proposals",
  ticket_updates: "DevRev updates log", agent_runs: "Agent runs (tokens)", app_sessions: "Sign-in sessions",
};

export async function GET(req: Request) {
  const g = await requireAdmin(req);
  if (g.error) return g.error;
  const [{ db, others }] = await q<{ db: number; others: number }>(
    `SELECT pg_database_size(current_database())::float AS db,
            (SELECT COALESCE(sum(pg_database_size(datname)), 0) FROM pg_database WHERE datname <> current_database())::float AS others`);
  // The change log needs a privileged role (Railway's default user has it); without it, it's left out.
  const wal = await q<{ b: number }>(`SELECT COALESCE(sum(size), 0)::float AS b FROM pg_ls_waldir()`).then((r) => r[0].b).catch(() => null);
  const tables = await q<{ t: string; bytes: number; rows: number }>(
    `SELECT relname AS t, pg_total_relation_size(relid)::float AS bytes, n_live_tup::int AS rows FROM pg_stat_user_tables ORDER BY 2 DESC`);
  const [grow] = await q<{ last30: number; total: number; first: string | null }>(
    `SELECT count(*) FILTER (WHERE created_at > now() - interval '30 days')::int last30, count(*)::int total, min(created_at)::text first FROM investigations`);
  const trail = tables.find((x) => x.t === "investigation_steps")?.bytes ?? 0;
  const files = tables.find((x) => x.t === "chat_files")?.bytes ?? 0;
  const perInvestigation = grow.total ? (trail + files) / grow.total : 0;
  // The server's disk. Only a disk of its own (a mounted volume, e.g. Railway volume at /data) has a meaningful size —
  // without one, free space is the whole host machine's (shared), so we show just what our own files use.
  let volume: { path: string; total: number; free: number } | null = null;
  try {
    if (existsSync("/data") && statSync("/data").dev !== statSync("/").dev) {
      const s = statfsSync("/data"); volume = { path: "/data", total: s.blocks * s.bsize, free: s.bavail * s.bsize };
    }
  } catch { /* not available */ }
  const own = await ownFiles();
  const sessions = (await storageSummary()).find((x) => x.label === "Agent sessions");
  const limitMb = Number(adminSetting("DB_DISK_LIMIT_MB")) || (Number(adminSetting("DB_DISK_LIMIT_GB")) * 1024) || null;
  const top = tables.filter((x) => x.bytes > 0).slice(0, 7);
  const rest = tables.slice(7).reduce((n, x) => n + x.bytes, 0);
  // What the list doesn't name: Postgres's own catalog tables inside this database — so the parts add up to the total.
  const internal = Math.max(0, db - tables.reduce((n, x) => n + x.bytes, 0));
  return Response.json({
    db: { bytes: db, limitBytes: limitMb ? limitMb * 1024 ** 2 : null, limitMb,
      // Everything on Postgres's disk we can see: this database, the system databases, the change log.
      disk: { used: db + others + (wal ?? 0), data: db, system: others, wal } },
    parts: [...top.map((x) => ({ key: x.t, label: LABEL[x.t] ?? x.t.replace(/_/g, " "), bytes: x.bytes, rows: x.rows })),
      ...(rest > 0 ? [{ key: "other", label: "Everything else", bytes: rest, rows: null }] : []),
      ...(internal > 0 ? [{ key: "internal", label: "Postgres's own tables (catalog)", bytes: internal, rows: null }] : [])],
    growth: { last30: grow.last30, total: grow.total, since: grow.first, perInvestigation, perMonth: grow.last30 * perInvestigation },
    volume, own, sessions: sessions ? { files: sessions.count, bytes: sessions.bytes } : null,
  });
}

/** What our own files on the server take: code copies, the agent's saved conversations, logs (du; cached 10 min). */
let ownCache: { at: number; value: { label: string; bytes: number }[] } | null = null;
async function ownFiles() {
  if (ownCache && Date.now() - ownCache.at < 10 * 60_000) return ownCache.value;
  const claude = process.env.CLAUDE_CONFIG_DIR || path.join(process.env.HOME || "/home/node", ".claude");
  const dirs = [["Code copies (for code search)", CODE_ROOT], ["Agent's saved conversations", claude], ["Logs", path.join(ROOT, ".logs")]] as const;
  const value = await Promise.all(dirs.map(([label, dir]) => new Promise<{ label: string; bytes: number }>((resolve) => {
    if (!existsSync(dir)) return resolve({ label, bytes: 0 });
    execFile("du", ["-sk", dir], { timeout: 20_000 }, (err, out) => resolve({ label, bytes: err ? 0 : (Number(out.split(/\s+/)[0]) || 0) * 1024 }));
  })));
  ownCache = { at: Date.now(), value };
  return value;
}

export async function POST(req: Request) {
  const g = await requireAdmin(req);
  if (g.error) return g.error;
  const b = (await req.json().catch(() => ({}))) as { dbLimitMb?: number | string };
  const v = String(b.dbLimitMb ?? "").trim();
  if (v && !(Number(v) > 0 && Number(v) <= 10_000_000)) return Response.json({ error: "Enter the database disk size in MB, e.g. 500" }, { status: 400 });
  await writeEnv({ DB_DISK_LIMIT_MB: v || null, DB_DISK_LIMIT_GB: null }, g.user.name);
  return Response.json({ ok: true, message: v ? `Database disk set to ${v} MB` : "Database disk size cleared" });
}
