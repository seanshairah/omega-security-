import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { cache } from "react";
import type { Role } from "@prisma/client";
import { db } from "@/lib/db";

const COOKIE = "omega_session";
const secret = () => {
  const v = process.env.AUTH_SECRET;
  // Development keeps a fixed fallback so a fresh checkout works; production refuses (see instrumentation.ts / env-check).
  if (!v && process.env.NODE_ENV === "production") throw new Error("AUTH_SECRET is not set");
  return new TextEncoder().encode(v || "dev-secret-change-me-dev-secret-change-me");
};

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  role: Role;
  avatarUrl: string | null;
  title: string | null;
};

export async function createSession(userId: string) {
  const token = await new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secret());
  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
}

export async function destroySession() {
  const jar = await cookies();
  jar.delete(COOKIE);
}

export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    const id = payload.sub;
    if (!id) return null;
    const user = await db.user.findUnique({
      where: { id },
      select: { id: true, name: true, email: true, role: true, avatarUrl: true, title: true, active: true },
    });
    if (!user || !user.active) return null;
    return { id: user.id, name: user.name, email: user.email, role: user.role, avatarUrl: user.avatarUrl, title: user.title };
  } catch {
    return null;
  }
});
