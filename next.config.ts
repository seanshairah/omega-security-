import type { NextConfig } from "next";

// Operate in the company's local time so shift times read as the guards see them.
process.env.TZ = process.env.TIMEZONE || "Africa/Harare";

const nextConfig: NextConfig = {
  // Self-contained server bundle for the Docker image (copied from .next/standalone); harmless on Vercel.
  output: "standalone",
  reactStrictMode: true,
  serverExternalPackages: ["@prisma/client", "@prisma/adapter-neon", "@neondatabase/serverless", "ws", "https-proxy-agent", "bcryptjs", "web-push"],
};

export default nextConfig;
