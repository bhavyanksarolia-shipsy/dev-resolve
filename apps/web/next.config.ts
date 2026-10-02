import type { NextConfig } from "next";

/**
 * Frontend (Vercel): pages only. Every /api request is forwarded to the backend (Railway) BEFORE Next looks for a
 * route, so the browser only ever talks to this one domain — login cookies, Google sign-in and same-origin checks
 * work exactly as with a single app, and there is no CORS to configure.
 *   BACKEND_URL  e.g. https://dev-resolve-api.up.railway.app  (local: http://localhost:3002)
 */
const BACKEND_URL = (process.env.BACKEND_URL || "http://localhost:3002").replace(/\/+$/, "");

const nextConfig: NextConfig = {
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*", "172.*.*.*"],
  devIndicators: false,
  poweredByHeader: false,
  async rewrites() {
    return {
      beforeFiles: [
        { source: "/api/:path*", destination: `${BACKEND_URL}/api/:path*` },
        { source: "/dev-resolve-connector.mjs", destination: `${BACKEND_URL}/dev-resolve-connector.mjs` },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
  async headers() {
    const security = [
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Content-Security-Policy", value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "same-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      ...(process.env.NODE_ENV === "production" ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }] : []),
    ];
    return [{ source: "/:path*", headers: security }];
  },
};

export default nextConfig;
