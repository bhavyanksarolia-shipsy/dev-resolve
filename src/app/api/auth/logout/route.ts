import { revokeSession, sessionCookie, sessionToken } from "@/lib/auth";

export async function POST(req: Request) {
  await revokeSession(sessionToken(req)).catch(() => {});
  return Response.json({ ok: true }, { headers: { "Set-Cookie": sessionCookie(req, "", 0) } });
}
