import { googleEnabled, startAuth } from "@/lib/google";

const OAUTH_COOKIE = "dr_oauth";

/** Step 1: send the browser to Google. state / nonce / PKCE verifier ride in a short-lived HttpOnly cookie. */
export async function GET(req: Request) {
  if (!googleEnabled()) return Response.redirect(new URL("/login?error=Google+sign-in+isn%27t+set+up", req.url), 302);
  const nextRaw = new URL(req.url).searchParams.get("next") || "/";
  const next = nextRaw.startsWith("/") && !nextRaw.startsWith("//") ? nextRaw : "/";
  const a = startAuth(req);
  const secure = (process.env.APP_URL || req.url).startsWith("https:");
  const value = Buffer.from(JSON.stringify({ s: a.state, n: a.nonce, v: a.verifier, next })).toString("base64url");
  return new Response(null, {
    status: 302,
    headers: { Location: a.url, "Set-Cookie": `${OAUTH_COOKIE}=${value}; Path=/api/auth/google; HttpOnly; SameSite=Lax; Max-Age=600${secure ? "; Secure" : ""}` },
  });
}
