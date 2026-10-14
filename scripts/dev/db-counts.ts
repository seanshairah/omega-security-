import { neon } from "@neondatabase/serverless";
import { config } from "dotenv"; config();
const sql = neon(process.env.DATABASE_URL!);
const tables = ["User","Guard","Client","Location","Shift","Attendance","ShiftCheckIn","WelfareCheck","Incident","SmsMessage","Notification","ShiftRecurrence","PushSubscription","AuditLog","MessageTemplate","Setting"];
(async () => {
  for (const t of tables) { try { const r = await sql.query(`SELECT count(*)::int AS n FROM "${t}"`); console.log(t, (r as any)[0].n); } catch (e) { console.log(t, "ERR", (e as Error).message.slice(0,60)); } }
  console.log(await sql.query(`SELECT id,name,email,role FROM "User"`));
})();
