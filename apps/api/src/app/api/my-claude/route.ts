import { sessionUser } from "@/lib/auth";
import { chainFor, fallbackPersonalOn, mainUpstream, personalToken, removePersonalToken, savePersonalToken, verifyClaudeToken } from "@/lib/claudeRoute";

/**
 * Your own Claude sign-in: the fallback for your investigations when the main Claude sign-in isn't working. Only you see
 * or change it — the full value is shown only to you (the eye button), never to admins.
 *   GET                         what's saved (masked), its type, the last check, what your investigations use in order
 *   POST {kind, token}          check with Anthropic, then save        POST {check: true}   check the saved one again
 *   POST {reveal: true}         the full value, for you                 DELETE               remove it
 */
const mask = (t: string) => `${t.slice(0, 14)}${"•".repeat(10)}${t.slice(-4)}`;
const kindOf = (t: string) => (t.startsWith("sk-ant-oat") ? "oauth" : "api");
const lastCheck = new Map<string, { ok: boolean; message: string; at: string }>();

export async function GET(req: Request) {
  const u = await sessionUser(req);
  if (!u) return Response.json({ error: "Sign in required" }, { status: 401 });
  const t = personalToken(u.name);
  return Response.json({
    enabled: fallbackPersonalOn(),
    main: mainUpstream()?.label ?? null,
    token: t ? { preview: mask(t.token), kind: kindOf(t.token), owner: t.owner, addedAt: t.addedAt, check: lastCheck.get(u.name) ?? null } : null,
    chain: chainFor(u.name).map((x) => (x.id.startsWith("personal:") ? "your own Claude token" : x.label)),
  });
}

export async function POST(req: Request) {
  const u = await sessionUser(req);
  if (!u) return Response.json({ error: "Sign in required" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { token?: string; kind?: "oauth" | "api"; check?: boolean; reveal?: boolean };
  const saved = personalToken(u.name);
  if (b.reveal) return Response.json({ value: saved?.token ?? null });
  if (b.check) {
    if (!saved) return Response.json({ error: "Nothing saved yet" }, { status: 400 });
    const v = await verifyClaudeToken(saved.token);
    const res = { ok: v.ok, message: v.ok ? `Working${v.owner ? ` · ${v.owner}` : ""}` : v.message, at: new Date().toISOString() };
    lastCheck.set(u.name, res);
    return Response.json(res, { status: v.ok ? 200 : 400 });
  }
  const token = String(b.token ?? "").replace(/\s+/g, "");
  const kind = b.kind ?? kindOf(token);
  const want = kind === "oauth" ? /^sk-ant-oat\d{2}-[A-Za-z0-9_-]{20,}$/ : /^sk-ant-api\d{2}-[A-Za-z0-9_-]{20,}$/;
  if (!want.test(token)) {
    return Response.json({ error: token.startsWith("sk-bf-") ? "That's a Bifrost key — paste your own Claude token or Anthropic API key"
      : kind === "oauth" ? "A Claude login token starts with sk-ant-oat01- (from `claude setup-token`)" : "An Anthropic API key starts with sk-ant-api03-" }, { status: 400 });
  }
  const v = await verifyClaudeToken(token);
  if (!v.ok) return Response.json({ error: v.message }, { status: 400 });
  savePersonalToken(u.name, token, v.owner);
  lastCheck.set(u.name, { ok: true, message: `Working${v.owner ? ` · ${v.owner}` : ""}`, at: new Date().toISOString() });
  return Response.json({ ok: true, message: v.owner ? `Saved — it belongs to ${v.owner}` : "Saved and working" });
}

export async function DELETE(req: Request) {
  const u = await sessionUser(req);
  if (!u) return Response.json({ error: "Sign in required" }, { status: 401 });
  await removePersonalToken(u.name);
  lastCheck.delete(u.name);
  return Response.json({ ok: true, message: "Removed" });
}
