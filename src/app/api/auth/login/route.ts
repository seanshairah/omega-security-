import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { audit } from "@/lib/audit";

export async function POST(req: Request) {
  const { email, password } = (await req.json().catch(() => ({}))) as { email?: string; password?: string };
  if (!email || !password) return NextResponse.json({ error: "email and password are required" }, { status: 400 });
  const user = await db.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user || !user.active || !(await verifyPassword(password, user.passwordHash))) return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  await createSession(user.id);
  await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await audit({ userId: user.id, actor: user.name, action: "USER_LOGIN", entity: "User", entityId: user.id, ip: req.headers.get("x-forwarded-for"), userAgent: req.headers.get("user-agent") });
  return NextResponse.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role } });
}
