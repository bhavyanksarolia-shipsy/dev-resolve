import { googleEnabled, googleProblem, publicOrigin, startAuth } from "@/lib/google";

const OAUTH_COOKIE = "dr_oauth";

/** Step 1: send the browser to Google. state / nonce / PKCE verifier ride in a short-lived HttpOnly cookie. */
export async function GET(req: Request) {
  if (!googleEnabled()) console.warn(`[auth] ${googleProblem()}`);
  if (!googleEnabled()) return Response.redirect(`${publicOrigin(req)}/login?error=Google+sign-in+isn%27t+set+up`, 302);
  const nextRaw = new URL(req.url).searchParams.get("next") || "/";
  const next = nextRaw.startsWith("/") && !nextRaw.startsWith("//") ? nextRaw : "/";
  const a = startAuth(req);
  const secure = publicOrigin(req).startsWith("https:");
  const value = Buffer.from(JSON.stringify({ s: a.state, n: a.nonce, v: a.verifier, next })).toString("base64url");
  return new Response(null, {
    status: 302,
    headers: { Location: a.url, "Set-Cookie": `${OAUTH_COOKIE}=${value}; Path=/api/auth/google; HttpOnly; SameSite=Lax; Max-Age=600${secure ? "; Secure" : ""}` },
  });
}
