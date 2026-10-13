import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import WebSocket from "ws";
import { HttpsProxyAgent } from "https-proxy-agent";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * Neon (serverless Postgres) is reached over HTTPS/WebSocket on port 443 via @prisma/adapter-neon,
 * which also works behind an HTTPS proxy. Any other Postgres uses Prisma's native engine on 5432.
 */
function createClient(): PrismaClient {
  const url = process.env.DATABASE_URL ?? "";
  const log: ("warn" | "error")[] = ["warn", "error"];
  if (!/neon\.tech/.test(url)) return new PrismaClient({ log });

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
