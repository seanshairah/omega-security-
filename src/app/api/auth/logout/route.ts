import { NextResponse } from "next/server";
import { destroySession } from "@/lib/auth/session";

async function handle(req: Request) {
  await destroySession();
  return NextResponse.redirect(new URL("/login", req.url), { status: 303 });
}
export const POST = handle;
export const GET = handle;
