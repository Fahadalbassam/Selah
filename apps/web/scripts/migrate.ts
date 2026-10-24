// Apply migrations as the schema owner. Usage: npm run db:migrate
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

const url = process.env.DATABASE_OWNER_URL;
if (!url) throw new Error("DATABASE_OWNER_URL is not set");

// fileURLToPath, not .pathname, so the path also works on Windows.
const folder = fileURLToPath(new URL("../drizzle", import.meta.url));
const pool = new Pool({ connectionString: url, max: 1 });

// The migrations before 0000_baseline were squashed into it (2026-10-23). A
// database built from them has the same schema but not the baseline's journal
// entry, so the migrator would try to create everything again.
const journal = JSON.parse(readFileSync(`${folder}/meta/_journal.json`, "utf8")) as { entries: { tag: string; when: number }[] };
const baseline = journal.entries.find((e) => e.tag === "0000_baseline");
const applied = await pool
  .query<{ created_at: string }>(`SELECT created_at FROM drizzle.__drizzle_migrations`)
  .then((r) => r.rows.map((row) => Number(row.created_at)))
  .catch((): number[] => []);
if (baseline && applied.length > 0 && !applied.includes(baseline.when)) {
  await pool.end();
  console.error(
    "This database was built from the migrations before the baseline. It holds sample data only: " +
      "drop it and migrate again (with Docker: docker compose down -v, then docker compose up).",
  );
  process.exit(1);
}

await migrate(drizzle(pool), { migrationsFolder: folder });
await pool.end();
console.log("migrations applied");
