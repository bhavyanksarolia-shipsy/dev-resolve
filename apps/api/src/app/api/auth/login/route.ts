import { login, sessionCookie } from "@/lib/auth";
import { passwordLoginEnabled } from "@/lib/google";

// Per-IP brake on top of the per-account lockout in login() (single app instance, so in-memory is enough).
const attempts = new Map<string, { n: number; at: number }>();
const WINDOW = 15 * 60e3;

export async function POST(req: Request) {
  if (!passwordLoginEnabled()) return Response.json({ error: "Password sign-in is turned off — use Sign in with Google" }, { status: 403 });
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
  const a = attempts.get(ip);
  if (a && a.n >= 20 && Date.now() - a.at < WINDOW) return Response.json({ error: "Too many attempts — try again in 15 minutes" }, { status: 429 });
  const { name, password } = (await req.json().catch(() => ({}))) as { name?: string; password?: string };
  if (!name || !password || name.length > 64 || password.length > 256) return Response.json({ error: "Wrong name or password" }, { status: 401 });
  const r = await login(name, password, { ip, userAgent: req.headers.get("user-agent") ?? undefined });
  if (!r.ok) {
    attempts.set(ip, { n: (a && Date.now() - a.at < WINDOW ? a.n : 0) + 1, at: Date.now() });
    return Response.json({ error: r.error }, { status: r.status });
  }
  attempts.delete(ip);
  return Response.json({ ok: true, user: r.user.name }, { headers: { "Set-Cookie": sessionCookie(req, r.token, r.maxAge) } });
}
