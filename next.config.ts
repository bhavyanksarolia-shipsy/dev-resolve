import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Node-only packages that spawn processes / hold sockets — keep them out of the bundle.
  serverExternalPackages: ["@anthropic-ai/claude-agent-sdk", "pg"],
  // Let teammates open the dev server from another machine (LAN IP) or through a tunnel.
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*", "172.*.*.*", "*.trycloudflare.com"],
  devIndicators: false,
  poweredByHeader: false,
  async headers() {
    const security = [
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Content-Security-Policy", value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "same-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      // HTTPS only once deployed behind TLS (browsers ignore it over plain http, so local dev is unaffected).
      ...(process.env.NODE_ENV === "production" ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }] : []),
    ];
    return [{ source: "/:path*", headers: security }];
  },
};

export default nextConfig;
