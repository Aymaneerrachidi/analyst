import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  outputFileTracingExcludes: { "/*": ["./.data/**/*", "./.vercel/**/*"] },
  serverExternalPackages: ["@electric-sql/pglite", "postgres"],
};

export default nextConfig;
