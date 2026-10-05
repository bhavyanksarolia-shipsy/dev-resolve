import { sessionUser } from "@/lib/auth";
import { googleEnabled, googleProblem, publicOrigin, startAuth } from "@/lib/google";

const OAUTH_COOKIE = "dr_oauth";

/** Step 1: send the browser to Google. state / nonce / PKCE verifier ride in a short-lived HttpOnly cookie. */
export async function GET(req: Request) {
  if (!googleEnabled()) console.warn(`[auth] ${googleProblem()}`);
  if (!googleEnabled()) return Response.redirect(`${publicOrigin(req)}/login?error=Google+sign-in+isn%27t+set+up`, 302);
  const params = new URL(req.url).searchParams;
  // ?purpose=mail — an admin connecting the Gmail mailbox that sends welcome emails (Admin → Connections → Email).
  const mail = params.get("purpose") === "mail";
  if (mail && !(await sessionUser(req))?.isAdmin) return Response.redirect(`${publicOrigin(req)}/login`, 302);
  const nextRaw = mail ? "/admin?tab=connections&sub=email" : params.get("next") || "/";
  const next = nextRaw.startsWith("/") && !nextRaw.startsWith("//") ? nextRaw : "/";
  const a = startAuth(req, { mail, hint: params.get("hint") || undefined });
  const secure = publicOrigin(req).startsWith("https:");
  const value = Buffer.from(JSON.stringify({ s: a.state, n: a.nonce, v: a.verifier, next, ...(mail && { mail: 1 }) })).toString("base64url");
  return new Response(null, {
    status: 302,
    headers: { Location: a.url, "Set-Cookie": `${OAUTH_COOKIE}=${value}; Path=/api/auth/google; HttpOnly; SameSite=Lax; Max-Age=600${secure ? "; Secure" : ""}` },
  });
}
