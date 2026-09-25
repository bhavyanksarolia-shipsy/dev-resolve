import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Node-only packages that spawn processes / hold sockets — keep them out of the bundle.
  serverExternalPackages: ["@anthropic-ai/claude-agent-sdk", "pg"],
};

export default nextConfig;
