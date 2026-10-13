import { config } from "dotenv"; config();
import { db } from "../../src/lib/db";
db.guard.updateMany({ where: { lastName: { in: ["Banda", "Ncube"] } }, data: { watched: true, watchedAt: new Date(), watchNote: "New recruit, second week. Confirm every arrival by phone if no reply." } }).then((r) => { console.log("watched", r.count); return db.$disconnect(); });
