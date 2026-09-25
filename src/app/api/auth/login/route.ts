import { checkLogin, createSession, SESSION_COOKIE } from "@/lib/auth";

const attempts = new Map<string, { n: number; at: number }>();

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
  const a = attempts.get(ip);
  if (a && a.n >= 10 && Date.now() - a.at < 15 * 60 * 1000) return Response.json({ error: "Too many attempts — try again in 15 minutes" }, { status: 429 });
  const { name, password } = (await req.json().catch(() => ({}))) as { name?: string; password?: string };
  const user = name && password ? checkLogin(name, password) : null;
  if (!user) {
    attempts.set(ip, { n: (a && Date.now() - a.at < 15 * 60 * 1000 ? a.n : 0) + 1, at: Date.now() });
    return Response.json({ error: "Wrong name or password" }, { status: 401 });
  }
  attempts.delete(ip);
  const s = createSession(user);
  const secure = new URL(req.url).protocol === "https:" || req.headers.get("x-forwarded-proto") === "https";
  return Response.json({ ok: true, user }, {
    headers: { "Set-Cookie": `${SESSION_COOKIE}=${s.value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${s.maxAge}${secure ? "; Secure" : ""}` },
  });
}
