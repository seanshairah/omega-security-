// Set a user's password: npx tsx scripts/set-password.ts admin@omegasecurity.co.zw 'NewPassword'
import { config } from "dotenv";
config();
import bcrypt from "bcryptjs";
import { db } from "../src/lib/db";

async function main() {
  const [email, password] = process.argv.slice(2);
  if (!email || !password) throw new Error("usage: set-password.ts <email> <password>");
  const u = await db.user.update({ where: { email }, data: { passwordHash: await bcrypt.hash(password, 10) } });
  console.log(`Password updated for ${u.email}`);
}
main().catch((e) => { console.error(e.message); process.exit(1); }).finally(() => db.$disconnect());
