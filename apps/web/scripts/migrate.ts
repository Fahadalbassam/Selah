// Apply migrations as the schema owner. Usage: npm run db:migrate
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

const url = process.env.DATABASE_OWNER_URL;
if (!url) throw new Error("DATABASE_OWNER_URL is not set");

const pool = new Pool({ connectionString: url, max: 1 });
await migrate(drizzle(pool), { migrationsFolder: new URL("../drizzle", import.meta.url).pathname });
await pool.end();
console.log("migrations applied");
