import { loginWithGoogle, sessionCookie, sessionUser } from "@/lib/auth";
import { finishAuth, GMAIL_SEND_SCOPE, googleEnabled, publicOrigin } from "@/lib/google";
import { writeEnv } from "@/lib/adminConfig";
import { revokeGmail } from "@/lib/mail";

/** Step 2: Google sends the browser back here with a code; verify everything, then open a Dev Resolve session. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const base = publicOrigin(req);
  const fail = (msg: string) => new Response(null, {
    status: 302,
    headers: [["Location", `${base}/login?error=${encodeURIComponent(msg)}`], ["Set-Cookie", "dr_oauth=; Path=/api/auth/google; Max-Age=0"]],
  });
  if (!googleEnabled()) return fail("Google sign-in isn't set up");
  if (url.searchParams.get("error")) return fail(url.searchParams.get("error") === "access_denied" ? "Google sign-in was cancelled" : "Google sign-in failed");
  let saved: { s: string; n: string; v: string; next: string; mail?: 1 };
  try {
    const raw = (req.headers.get("cookie") || "").match(/(?:^|;\s*)dr_oauth=([^;]+)/)?.[1];
    saved = JSON.parse(Buffer.from(raw || "", "base64url").toString());
  } catch {
    return fail("Sign-in took too long or started in another browser — try again");
  }
  if (!saved?.s || url.searchParams.get("state") !== saved.s) return fail("Sign-in didn't match — try again");
  if (saved.mail) return connectMail(req, url, saved, base);
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

/** "Connect Gmail" (Admin → Connections → Email): keep the mailbox's send-only refresh token; back to the Email tab. */
async function connectMail(req: Request, url: URL, saved: { n: string; v: string; next: string }, base: string) {
  const back = (q: string) => new Response(null, {
    status: 302, headers: [["Location", `${base}${saved.next}&${q}`], ["Set-Cookie", "dr_oauth=; Path=/api/auth/google; Max-Age=0"]],
  });
  const admin = await sessionUser(req);
  if (!admin?.isAdmin) return back(`mail_error=${encodeURIComponent("Only admins can connect the mailbox")}`);
  try {
    const id = await finishAuth(req, url.searchParams.get("code") || "", saved.v, saved.n);
    if (!id.scope.split(" ").includes(GMAIL_SEND_SCOPE)) return back(`mail_error=${encodeURIComponent('Google didn\'t allow sending — tick "Send email on your behalf" on Google\'s screen')}`);
    if (!id.refreshToken) return back(`mail_error=${encodeURIComponent("Google didn't return a lasting permission — try Connect Gmail again")}`);
    await revokeGmail(); // the previously connected mailbox, if any
    await writeEnv({ GMAIL_REFRESH_TOKEN: id.refreshToken, GMAIL_SENDER: id.email }, admin.name);
    return back(`mail_connected=${encodeURIComponent(id.email)}`);
  } catch (e) {
    return back(`mail_error=${encodeURIComponent((e as Error).message)}`);
  }
}
