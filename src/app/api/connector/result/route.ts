import { complete, connectorUser, type RelayResponse } from "@/lib/connector";

export async function POST(req: Request) {
  const user = await connectorUser(req);
  if (!user) return Response.json({ error: "Connector token not valid" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { id?: string; ok?: boolean; res?: RelayResponse; error?: string };
  if (!b.id) return Response.json({ error: "id required" }, { status: 400 });
  const ok = complete(user, b.id, b.ok && b.res ? { ok: true, res: b.res } : { ok: false, error: b.error || "connector error" });
  return Response.json({ ok });
}
