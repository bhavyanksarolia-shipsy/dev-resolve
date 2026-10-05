import { requireAdmin } from "@/lib/adminGuard";
import { writeEnv } from "@/lib/adminConfig";
import { availableRepos, checkAccess, codeRepos, codeStatus, connectedRepos, revealToken, syncCode, syncRepo } from "@/lib/codeSync";

/** Admin → Connections → Source code: where the agent's code comes from, and whether it's on this server. */
export async function GET(req: Request) {
  const g = await requireAdmin(req);
  if (g.error) return g.error;
  const sp = new URL(req.url).searchParams;
  if (sp.get("repos") === "1") return Response.json({ repos: await availableRepos().catch(() => []) });       // everything the token can read
  if (sp.get("connected") === "1") return Response.json({ repos: connectedRepos() });                           // what clients may pick
  return Response.json(codeStatus());
}

export async function POST(req: Request) {
  const g = await requireAdmin(req);
  if (g.error) return g.error;
  const b = (await req.json().catch(() => ({}))) as { action?: string; base?: string; branch?: string; token?: string; repos?: string[]; repo?: string };
  if (b.action === "save") {
    const url = String(b.base ?? "").trim().replace(/\/+$/, "");
    if (url && !/^https:\/\/[^\s/]+\/[^\s]+$/.test(url)) return Response.json({ error: "Use the GitHub organisation address, e.g. https://github.com/<org>" }, { status: 400 });
    const updates: Record<string, string | null> = { CODE_GIT_BASE: url || null, CODE_GIT_BRANCH: String(b.branch ?? "").trim() || null };
    if (b.token) updates.GITHUB_TOKEN = String(b.token).replace(/[\r\n]/g, "").trim(); // empty = keep the stored token
    await writeEnv(updates, g.user.name);
  } else if (b.action === "repos") {
    const repos = [...new Set((b.repos ?? []).map((r) => String(r).trim()).filter((r) => /^[A-Za-z0-9._-]+$/.test(r)))].sort();
    await writeEnv({ CODE_REPOS: repos.join(",") }, g.user.name);
  } else if (b.action === "reveal") {
    console.log(`[admin] ${g.user.name} revealed the GitHub token`);
    return Response.json({ token: revealToken() });
  } else if (b.action === "check") {
    const r = await checkAccess();
    return Response.json(r.ok ? { ok: true, message: r.message } : { error: r.message });
  } else if (b.action === "sync_repo") {
    const repo = String(b.repo ?? "").trim();
    if (!/^[A-Za-z0-9._-]+$/.test(repo) || !codeRepos().includes(repo)) return Response.json({ error: "Unknown repo" }, { status: 400 });
    const r = await syncRepo(repo);
    return Response.json({ ok: r.ok, message: r.ok ? `${repo} connected · ${r.commit}` : undefined, error: r.ok ? undefined : `${repo}: ${r.error}`, status: codeStatus() });
  } else if (b.action !== "sync") return Response.json({ error: "unknown action" }, { status: 400 });
  const r = await syncCode();
  return Response.json({ ok: r.ok, message: r.ok ? `Code synced (${r.repos.length} repos)` : undefined, error: r.ok ? undefined : r.error || r.repos.filter((x) => !x.ok).map((x) => `${x.repo}: ${x.error}`).join(" · "), status: codeStatus() });
}
