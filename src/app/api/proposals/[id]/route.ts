import { q } from "@/lib/db";
import { getAccount } from "@/lib/config";
import { applyToFiles } from "@/lib/knowledge";
import { currentUser } from "@/lib/auth";

export async function POST(req: Request, ctx: RouteContext<"/api/proposals/[id]">) {
  const { id } = await ctx.params;
  const { action, content, file } = (await req.json()) as { action: "accept" | "reject"; content?: string; file?: string };
  const [p] = await q<{ id: number; account_slug: string; file: string; content: string; status: string; investigation_id: number }>(
    `SELECT * FROM knowledge_proposals WHERE id=$1`, [id]);
  if (!p) return Response.json({ error: "not found" }, { status: 404 });
  if (p.status !== "pending") return Response.json({ error: `already ${p.status}` }, { status: 409 });
  if (action === "accept") {
    const target = p.account_slug === "_shared" ? { slug: "_shared", knowledge_dir: "knowledge/_shared" } : getAccount(p.account_slug);
    if (!target) return Response.json({ error: `account ${p.account_slug} not in config` }, { status: 400 });
    try {
      applyToFiles(target, file ?? p.file, content ?? p.content, `proposal #${p.id} · investigation #${p.investigation_id} · accepted by ${currentUser(req)} ${new Date().toISOString().slice(0, 10)}`);
    } catch (e) {
      return Response.json({ error: (e as Error).message }, { status: 400 });
    }
  }
  await q(`UPDATE knowledge_proposals SET status=$2, content=COALESCE($3, content), file=COALESCE($4, file), decided_at=now(), decided_by=$5 WHERE id=$1`, [
    id, action === "accept" ? "accepted" : "rejected", content ?? null, file ?? null, currentUser(req),
  ]);
  return Response.json({ ok: true });
}
