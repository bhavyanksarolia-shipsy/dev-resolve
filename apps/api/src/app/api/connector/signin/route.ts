import { connectorUser, saveAppLogTokens, saveMetabaseSession } from "@/lib/connector";
import { appLogInfo } from "@/lib/connectorInfo";

/** The connector hands over a sign-in it just did in the person's own browser. Stored for that person only. */
export async function POST(req: Request) {
  const user = await connectorUser(req);
  if (!user) return Response.json({ error: "Connector token not valid" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { kind?: string; project?: string; session?: string; tokens?: Record<string, unknown> };
  try {
    if (b.kind === "metabase" && b.project && b.session) saveMetabaseSession(user, b.project, b.session);
    else if (b.kind === "app_log" && b.tokens && appLogInfo()) saveAppLogTokens(user, appLogInfo()!.gateway, b.tokens);
    else return Response.json({ error: "kind must be metabase (project, session) or app_log (tokens)" }, { status: 400 });
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
