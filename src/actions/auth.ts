"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { db } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/password";
import { createSession, destroySession, getSessionUser } from "@/lib/auth/session";
import { audit } from "@/lib/audit";

export async function login(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const user = await db.user.findUnique({ where: { email } });
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    await audit({ actor: email || "unknown", action: "LOGIN_FAILED", entity: "User", details: { email } });
    redirect("/login?error=1");
  }
  if (!user.active) redirect("/login?error=inactive");
  const h = await headers();
  await createSession(user.id);
  await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await audit({ userId: user.id, actor: user.name, action: "USER_LOGIN", entity: "User", entityId: user.id, ip: h.get("x-forwarded-for") ?? h.get("x-real-ip"), userAgent: h.get("user-agent") });
  redirect("/dashboard");
}

export async function logout() {
  const user = await getSessionUser();
  if (user) await audit({ userId: user.id, actor: user.name, action: "USER_LOGOUT", entity: "User", entityId: user.id });
  await destroySession();
  redirect("/login");
}
