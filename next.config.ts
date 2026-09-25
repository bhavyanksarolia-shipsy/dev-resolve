import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Node-only packages that spawn processes / hold sockets — keep them out of the bundle.
  serverExternalPackages: ["@anthropic-ai/claude-agent-sdk", "pg"],
  // Let teammates open the dev server from another machine (LAN IP) or through a tunnel.
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*", "172.*.*.*", "*.trycloudflare.com"],
  devIndicators: false,
};

export default nextConfig;
