import { db } from "@/lib/db";
import { guarded, json, paging } from "@/lib/api";

export const GET = guarded("SUPERVISOR", async (req) => {
  const url = new URL(req.url);
  const { take, skip } = paging(url);
  const unreadOnly = url.searchParams.get("unread") === "1";
  const items = await db.notification.findMany({ where: unreadOnly ? { readAt: null } : {}, orderBy: { createdAt: "desc" }, take, skip });
  return json({ items, unread: await db.notification.count({ where: { readAt: null } }) });
});
