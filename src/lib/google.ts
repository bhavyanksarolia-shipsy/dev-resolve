import "server-only";
import { createHash, createPublicKey, randomBytes, verify, type JsonWebKey } from "node:crypto";

/**
 * "Sign in with Google" (OpenID Connect, authorization code + PKCE) for the Dev Resolve login itself.
 * Env: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET (a "Web application" OAuth client whose authorized redirect URI is
 * <APP_URL>/api/auth/google/callback), GOOGLE_ALLOWED_DOMAINS (comma list, e.g. your company domain — required),
 * GOOGLE_ADMIN_EMAILS (made admin on first sign-in), GOOGLE_AUTO_CREATE (default on: new people get a member login).
 */
export const googleEnabled = () => !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && allowedDomains().length);
export const allowedDomains = () => (process.env.GOOGLE_ALLOWED_DOMAINS || "").split(",").map((d) => d.trim().toLowerCase()).filter(Boolean);
export const passwordLoginEnabled = () => !["off", "0", "false"].includes((process.env.DEV_RESOLVE_PASSWORD_LOGIN || "on").toLowerCase());

/** The URL people use to reach Dev Resolve: APP_URL when set, else what the browser asked for (Host header). */
export function publicOrigin(req: Request) {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/+$/, "");
  const u = new URL(req.url);
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || u.host;
  return `${req.headers.get("x-forwarded-proto") || u.protocol.replace(":", "")}://${host}`;
}

export function redirectUri(req: Request) {
  return `${publicOrigin(req)}/api/auth/google/callback`;
}

export function startAuth(req: Request) {
  const state = randomBytes(16).toString("base64url");
  const nonce = randomBytes(16).toString("base64url");
  const verifier = randomBytes(32).toString("base64url");
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!, redirect_uri: redirectUri(req), response_type: "code",
    scope: "openid email profile", state, nonce, prompt: "select_account",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256",
    // Only shows / accepts accounts of this domain in Google's chooser (still checked again below).
    ...(allowedDomains().length === 1 && { hd: allowedDomains()[0] }),
  }).toString();
  return { url: url.toString(), state, nonce, verifier };
}

interface IdClaims { iss: string; aud: string; exp: number; nonce?: string; email?: string; email_verified?: boolean; hd?: string; name?: string; sub: string }

let jwks: { at: number; keys: (JsonWebKey & { kid?: string })[] } | null = null;
async function googleKey(kid: string) {
  if (!jwks || Date.now() - jwks.at > 3600e3 || !jwks.keys.some((k) => k.kid === kid)) {
    const r = await fetch("https://www.googleapis.com/oauth2/v3/certs", { signal: AbortSignal.timeout(10_000) });
    jwks = { at: Date.now(), keys: (await r.json()).keys };
  }
  const k = jwks.keys.find((x) => x.kid === kid);
  if (!k) throw new Error("unknown Google signing key");
  return createPublicKey({ key: k, format: "jwk" });
}

/** Code → tokens → a verified identity (signature, issuer, audience, expiry, nonce, verified email, allowed domain). */
export async function finishAuth(req: Request, code: string, verifier: string, nonce: string) {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", signal: AbortSignal.timeout(15_000),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: redirectUri(req),
      client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  });
  const t = await r.json();
  if (!r.ok || !t.id_token) throw new Error(t.error_description || t.error || "Google didn't return an identity");
  const [h, p, s] = String(t.id_token).split(".");
  const header = JSON.parse(Buffer.from(h, "base64url").toString());
  if (header.alg !== "RS256") throw new Error("unexpected token algorithm");
  if (!verify("RSA-SHA256", Buffer.from(`${h}.${p}`), await googleKey(header.kid), Buffer.from(s, "base64url"))) throw new Error("bad token signature");
  const c = JSON.parse(Buffer.from(p, "base64url").toString()) as IdClaims;
  if (!["https://accounts.google.com", "accounts.google.com"].includes(c.iss)) throw new Error("wrong issuer");
  if (c.aud !== process.env.GOOGLE_CLIENT_ID) throw new Error("token is for another app");
  if (c.exp * 1000 < Date.now() - 60_000) throw new Error("token expired");
  if (c.nonce !== nonce) throw new Error("sign-in didn't match (nonce)");
  const email = (c.email || "").toLowerCase();
  if (!email || c.email_verified !== true) throw new Error("Google account has no verified email");
  const domain = email.split("@")[1];
  if (!allowedDomains().includes(domain) || (c.hd && c.hd.toLowerCase() !== domain)) throw new Error(`${domain} accounts can't sign in here`);
  return { email, name: c.name || email };
}
