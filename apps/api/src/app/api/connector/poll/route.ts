import { connectorUser, poll, takeSignin } from "@/lib/connector";

export async function GET(req: Request) {
  const user = await connectorUser(req);
  if (!user) return Response.json({ error: "Connector token not valid" }, { status: 401 });
  let vpn: Record<string, boolean> = {};
  try { vpn = JSON.parse(req.headers.get("x-connector-vpn") || "{}"); } catch { /* ignore */ }
  const jobs = await poll(user, vpn, req.headers.get("x-connector-version") || undefined);
  return Response.json({ jobs: jobs.map((j) => ({ id: j.id, req: j.req })), signin: takeSignin(user) });
}
