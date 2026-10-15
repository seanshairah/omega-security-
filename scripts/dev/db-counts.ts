import { config } from "dotenv"; config();
import { db } from "../../src/lib/db";
(async () => {
  const tables = ["user","guard","client","location","shift","attendance","shiftCheckIn","welfareCheck","incident","smsMessage","notification","shiftRecurrence","pushSubscription","auditLog","messageTemplate","setting","gatewayDevice","gatewayEvent","callLog"] as const;
  for (const t of tables) console.log(t, await (db[t] as unknown as { count: () => Promise<number> }).count());
  const byAction = await db.auditLog.groupBy({ by: ["action"], _count: { _all: true }, orderBy: { _count: { action: "desc" } }, take: 15 });
  console.log(byAction.map((r) => `${r.action}=${r._count._all}`).join(" "));
  console.log("sms outbound:", await db.smsMessage.count({ where: { direction: "OUTBOUND" } }), "first audit:", (await db.auditLog.findFirst({ orderBy: { createdAt: "asc" } }))?.createdAt);
  await db.$disconnect();
})();
