import "server-only";
import { cfgValue } from "./config";

/**
 * Every port and URL Dev Resolve uses, in one place. Each one is read from the environment first (Render / Docker /
 * .env.local), then config/config.env, then the default below. Nothing else in the code hardcodes a host or port.
 * (The frontend calls the backend on the same origin — /api/... — so there is no separate "backend URL".)
 */
const get = (key: string, fallback: string) => (cfgValue(key) || fallback).trim();
/** URL setting without a trailing slash; a bare domain ("x.vercel.app") gets https:// (http only for localhost). */
const url = (key: string, fallback: string) => {
  const v = get(key, fallback).replace(/\/+$/, "");
  if (!v || /^https?:\/\//i.test(v)) return v;
  return `${/^(localhost|127\.0\.0\.1)(:|$)/.test(v) ? "http" : "https"}://${v}`;
};

export const settings = {
  /** Port the server listens on (Render sets PORT=10000; Docker image default 3000; local `npm run up` 3001). */
  port: () => Number(get("PORT", "3000")),
  /** Public URL people open (https://…). Used for Google redirects, connector setup, the allowed origin. */
  appUrl: () => url("APP_URL", ""),
  /**
   * The backend's own public URL (Railway). Laptop connectors talk to it directly — not through the frontend's
   * /api forwarding — so their 25 s long-polls aren't cut short. Empty = same as APP_URL (single-app setup).
   */
  backendPublicUrl: () => url("BACKEND_PUBLIC_URL", ""),
  /** How the server's own tools reach it (the connector relay). Same machine — only change behind unusual proxies. */
  internalUrl: () => url("INTERNAL_URL", `http://127.0.0.1:${get("PORT", "3000")}`),

  devrevApiUrl: () => url("DEVREV_BASE_URL", "https://api.devrev.ai"),
  devrevAppUrl: () => url("DEVREV_APP_URL", "https://app.devrev.ai"),
  anthropicApiUrl: () => url("ANTHROPIC_BASE_URL", "https://api.anthropic.com"),

  googleAuthUrl: () => url("GOOGLE_AUTH_URL", "https://accounts.google.com/o/oauth2/v2/auth"),
  googleTokenUrl: () => url("GOOGLE_TOKEN_URL", "https://oauth2.googleapis.com/token"),
  googleCertsUrl: () => url("GOOGLE_CERTS_URL", "https://www.googleapis.com/oauth2/v3/certs"),

  /** Where the connector on each laptop receives the app-logs sign-in (must match the app-logs OAuth client). */
  appLogCallbackPort: () => Number(get("APP_LOG_CALLBACK_PORT", "3334")),
};

/** What's in effect (no secrets) — printed at startup so a wrong port/URL is obvious in the logs. */
export function settingsSummary() {
  return {
    port: settings.port(), appUrl: settings.appUrl() || "(not set — falls back to the request's host)",
    backendPublicUrl: settings.backendPublicUrl() || "(same as appUrl)",
    internalUrl: settings.internalUrl(), devrevApi: settings.devrevApiUrl(), devrevApp: settings.devrevAppUrl(),
    anthropicApi: settings.anthropicApiUrl(), appLogCallbackPort: settings.appLogCallbackPort(),
  };
}
