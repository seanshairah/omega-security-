import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import WebSocket from "ws";
import { HttpsProxyAgent } from "https-proxy-agent";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * By default Prisma's native engine connects over TCP (port 5432), which is what Vercel and any
 * normal host should use. Set DATABASE_OVER_HTTP=true (or run behind an HTTPS proxy that blocks
 * 5432) to reach Neon through @prisma/adapter-neon over HTTPS/WebSocket on port 443 instead.
 */
export function usesNeonHttp(): boolean {
  const url = process.env.DATABASE_URL ?? "";
  if (!/neon\.tech/.test(url)) return false;
  if (process.env.DATABASE_OVER_HTTP === "true") return true;
  if (process.env.DATABASE_OVER_HTTP === "false") return false;
  return Boolean(process.env.HTTPS_PROXY || process.env.https_proxy);
}

function createClient(): PrismaClient {
  const url = process.env.DATABASE_URL ?? "";
  const log: ("warn" | "error")[] = ["warn", "error"];
  if (!usesNeonHttp()) return new PrismaClient({ log });

  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  if (proxy) {
    const agent = new HttpsProxyAgent(proxy);
    class ProxiedWebSocket extends WebSocket {
      constructor(address: string | URL, protocols?: string | string[]) {
        super(address, protocols, { agent });
      }
    }
    neonConfig.webSocketConstructor = ProxiedWebSocket as unknown as typeof WebSocket;
  } else {
    neonConfig.webSocketConstructor = WebSocket;
  }
  neonConfig.poolQueryViaFetch = true;
  const adapter = new PrismaNeon({ connectionString: url });
  return new PrismaClient({ adapter, log });
}

export const db = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
