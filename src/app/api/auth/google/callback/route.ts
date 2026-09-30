import { loginWithGoogle, sessionCookie } from "@/lib/auth";
import { finishAuth, googleEnabled } from "@/lib/google";

/** Step 2: Google sends the browser back here with a code; verify everything, then open a Dev Resolve session. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const base = process.env.APP_URL || url.origin;
  const fail = (msg: string) => new Response(null, {
    status: 302,
    headers: [["Location", `${base}/login?error=${encodeURIComponent(msg)}`], ["Set-Cookie", "dr_oauth=; Path=/api/auth/google; Max-Age=0"]],
  });
  if (!googleEnabled()) return fail("Google sign-in isn't set up");
  if (url.searchParams.get("error")) return fail(url.searchParams.get("error") === "access_denied" ? "Google sign-in was cancelled" : "Google sign-in failed");
  let saved: { s: string; n: string; v: string; next: string };
  try {
    const raw = (req.headers.get("cookie") || "").match(/(?:^|;\s*)dr_oauth=([^;]+)/)?.[1];
    saved = JSON.parse(Buffer.from(raw || "", "base64url").toString());
  } catch {
    return fail("Sign-in took too long or started in another browser — try again");
  }
  if (!saved?.s || url.searchParams.get("state") !== saved.s) return fail("Sign-in didn't match — try again");
  try {
    const id = await finishAuth(req, url.searchParams.get("code") || "", saved.v, saved.n);
    const r = await loginWithGoogle(id.email, id.name, {
      ip: req.headers.get("x-forwarded-for")?.split(",")[0].trim(), userAgent: req.headers.get("user-agent") ?? undefined,
    });
    if (!r.ok) return fail(r.error);
    return new Response(null, {
      status: 302,
      headers: [["Location", `${base}${saved.next || "/"}`], ["Set-Cookie", sessionCookie(req, r.token, r.maxAge)], ["Set-Cookie", "dr_oauth=; Path=/api/auth/google; Max-Age=0"]],
    });
  } catch (e) {
    return fail((e as Error).message);
  }
}
