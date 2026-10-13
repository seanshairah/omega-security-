// Set a user's password: npx tsx scripts/set-password.ts admin@omegasecurity.co.zw 'NewPassword'
import { config } from "dotenv";
config();
import bcrypt from "bcryptjs";
import { db } from "../src/lib/db";

const [email, password] = process.argv.slice(2);
if (!email || !password) { console.error("usage: set-password.ts <email> <password>"); process.exit(1); }
db.user.update({ where: { email }, data: { passwordHash: await bcrypt.hash(password, 10) } })
  .then((u) => { console.log(`Password updated for ${u.email}`); return db.$disconnect(); })
  .catch((e) => { console.error(e.message); process.exit(1); });
