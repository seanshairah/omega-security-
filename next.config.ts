import type { NextConfig } from "next";

// Operate in the company's local time so shift times read as the guards see them.
process.env.TZ = process.env.TIMEZONE || "Africa/Harare";

const nextConfig: NextConfig = {
  // Self-contained server bundle for the Docker image (copied from .next/standalone); harmless on Vercel.
  output: "standalone",
  reactStrictMode: true,
  serverExternalPackages: ["@prisma/client", "@prisma/adapter-neon", "@neondatabase/serverless", "ws", "https-proxy-agent", "bcryptjs", "web-push"],
  // Security headers for every response. HSTS only in production (local http must keep working).
  async headers() {
    const common = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      // Browser geolocation is used by the site picker on this origin only; nothing else needs device sensors.
      { key: "Permissions-Policy", value: "geolocation=(self), camera=(), microphone=(), payment=(), usb=()" },
      { key: "X-DNS-Prefetch-Control", value: "off" },
    ];
    const hsts = process.env.NODE_ENV === "production" ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }] : [];
    return [{ source: "/(.*)", headers: [...common, ...hsts] }];
  },
};

export default nextConfig;
