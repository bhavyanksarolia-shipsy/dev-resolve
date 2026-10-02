import { requireAdmin } from "@/lib/adminGuard";
import { writeEnv } from "@/lib/adminConfig";
import { codeStatus, syncCode } from "@/lib/codeSync";

/** Admin → Connections → Source code: where the agent's code comes from, and whether it's on this server. */
export async function GET(req: Request) {
  const g = await requireAdmin(req);
  if (g.error) return g.error;
  return Response.json(codeStatus());
}

export async function POST(req: Request) {
  const g = await requireAdmin(req);
  if (g.error) return g.error;
  const b = (await req.json().catch(() => ({}))) as { action?: string; base?: string; branch?: string; token?: string };
  if (b.action === "save") {
    const url = String(b.base ?? "").trim().replace(/\/+$/, "");
    if (url && !/^https:\/\/[^\s/]+\/[^\s]+$/.test(url)) return Response.json({ error: "Use the GitHub organisation address, e.g. https://github.com/<org>" }, { status: 400 });
    const updates: Record<string, string | null> = { CODE_GIT_BASE: url || null, CODE_GIT_BRANCH: String(b.branch ?? "").trim() || null };
    if (b.token) updates.GITHUB_TOKEN = String(b.token).replace(/[\r\n]/g, "").trim(); // empty = keep the stored token
    await writeEnv(updates, g.user.name);
  } else if (b.action !== "sync") return Response.json({ error: "unknown action" }, { status: 400 });
  const r = await syncCode();
  return Response.json({ ok: r.ok, message: r.ok ? `Code synced (${r.repos.length} repos)` : undefined, error: r.ok ? undefined : r.error || r.repos.filter((x) => !x.ok).map((x) => `${x.repo}: ${x.error}`).join(" · "), status: codeStatus() });
}
