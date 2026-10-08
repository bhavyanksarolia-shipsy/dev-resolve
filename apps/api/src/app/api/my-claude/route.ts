import { sessionUser } from "@/lib/auth";
import { chainFor, fallbackPersonalOn, mainUpstream, personalToken, removePersonalToken, savePersonalToken, verifyClaudeToken } from "@/lib/claudeRoute";

/**
 * Your own Claude token: the fallback for your investigations when the main Claude sign-in isn't working. Only you see
 * or change it (never shown back in full, not even to admins).
 */
const mask = (t: string) => `${t.slice(0, 12)}••••••••${t.slice(-4)}`;

export async function GET(req: Request) {
  const u = await sessionUser(req);
  if (!u) return Response.json({ error: "Sign in required" }, { status: 401 });
  const t = personalToken(u.name);
  const main = mainUpstream();
  return Response.json({
    enabled: fallbackPersonalOn(),
    main: main?.label ?? null,
    token: t ? { preview: mask(t.token), owner: t.owner, addedAt: t.addedAt } : null,
    // What your investigations use, in order.
    chain: chainFor(u.name).map((x) => x.id.startsWith("personal:") ? "your own Claude token" : x.label),
  });
}

export async function POST(req: Request) {
  const u = await sessionUser(req);
  if (!u) return Response.json({ error: "Sign in required" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { token?: string };
  const token = String(b.token ?? "").replace(/\s+/g, "");
  if (!/^sk-ant-(oat|api)\d{2}-[A-Za-z0-9_-]{20,}$/.test(token)) {
    return Response.json({ error: token.startsWith("sk-bf-") ? "That's a Bifrost key — paste your own Claude token (sk-ant-oat01-…)" : "That doesn't look like a Claude token — it starts with sk-ant-oat01- (or sk-ant-api03- for an API key)" }, { status: 400 });
  }
  const v = await verifyClaudeToken(token);
  if (!v.ok) return Response.json({ error: v.message }, { status: 400 });
  savePersonalToken(u.name, token, v.owner);
  return Response.json({ ok: true, message: v.owner ? `Saved — it belongs to ${v.owner}` : "Saved and working" });
}

export async function DELETE(req: Request) {
  const u = await sessionUser(req);
  if (!u) return Response.json({ error: "Sign in required" }, { status: 401 });
  await removePersonalToken(u.name);
  return Response.json({ ok: true, message: "Removed" });
}
