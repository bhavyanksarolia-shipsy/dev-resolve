import { requireAdmin } from "@/lib/adminGuard";
import { getAccounts } from "@/lib/config";
import { promptPreview } from "@/lib/agent/run";
import { assignSkill, deleteSkill, listSkills, readSkill, saveSkill, skillAssignments } from "@/lib/skills";

/**
 * Admin → Connections → Claude → Skills.
 * GET: every skill (name, description, size, who uses it) and the clients; ?name=x → that SKILL.md;
 * ?prompt=<client slug> → the built-in instructions the agent gets for that client.
 */
export async function GET(req: Request) {
  const g = await requireAdmin(req);
  if (g.error) return g.error;
  const sp = new URL(req.url).searchParams;
  if (sp.get("name")) {
    const md = readSkill(sp.get("name")!);
    return md == null ? Response.json({ error: "No such skill" }, { status: 404 }) : Response.json({ name: sp.get("name"), markdown: md });
  }
  if (sp.get("prompt")) {
    const md = promptPreview(sp.get("prompt")!);
    return md == null ? Response.json({ error: "No such client" }, { status: 404 }) : Response.json({ markdown: md });
  }
  const used = skillAssignments();
  return Response.json({
    skills: listSkills().map((s) => ({ ...s, ...used(s.name) })),
    clients: getAccounts().map((a) => ({ slug: a.slug, name: a.name, active: a.client_active !== false })).sort((a, b) => a.name.localeCompare(b.name)),
  });
}

/** { action: "upload", markdown, replace? } | { action: "assign", name, all, clients } | { action: "delete", name } */
export async function POST(req: Request) {
  const g = await requireAdmin(req);
  if (g.error) return g.error;
  const b = (await req.json().catch(() => ({}))) as { action?: string; markdown?: string; replace?: string; name?: string; all?: boolean; clients?: string[] };
  try {
    if (b.action === "upload") {
      const r = await saveSkill(String(b.markdown ?? ""), g.user.name, b.replace || undefined);
      console.log(`[skills] ${g.user.name} ${r.existed ? "replaced" : "added"} ${r.name}`);
      return Response.json({ ok: true, name: r.name, existed: r.existed, message: `${r.existed ? "Updated" : "Added"} skill ${r.name}${r.existed ? "" : " — choose which clients use it"}` });
    }
    if (b.action === "assign") {
      const slugs = new Set(getAccounts().map((a) => a.slug));
      await assignSkill(String(b.name), !!b.all, (b.clients ?? []).filter((c) => slugs.has(c)), g.user.name);
      return Response.json({ ok: true, message: "Saved — used from the next investigation" });
    }
    if (b.action === "delete") {
      await deleteSkill(String(b.name), g.user.name);
      console.log(`[skills] ${g.user.name} deleted ${b.name}`);
      return Response.json({ ok: true, message: `Deleted ${b.name}` });
    }
    return Response.json({ error: "unknown action" }, { status: 400 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
