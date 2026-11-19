// Before go-live, once: blank the private file name and reason kept in old
// withdrawal rows of the audit log and the activity record (written before
// migration 0106). See src/jobs/clean-private-names.ts for what and why, and
// docs/operations.md, "Before go-live", for when to run it.
//
// Run as the schema owner, with the web app and the jobs stopped.
//   npm run pre-go-live:clean-private-names               dry run: counts only, changes nothing
//   npm run pre-go-live:clean-private-names -- --apply    asks you to type the database name, then cleans
// A database whose name looks like a test or check copy is refused unless
// --allow-test is given.
import { createInterface } from "node:readline/promises";
import { Pool } from "pg";
import { cleanPrivateNames, reportLines } from "../../src/jobs/clean-private-names";

const url = process.env.DATABASE_OWNER_URL;
if (!url) throw new Error("DATABASE_OWNER_URL is not set");

const args = process.argv.slice(2);
const unknown = args.filter((a) => a !== "--apply" && a !== "--allow-test");
if (unknown.length) {
  console.error(`unknown option(s): ${unknown.join(" ")} (use --apply, --allow-test)`);
  process.exit(64);
}
const apply = args.includes("--apply");
const allowTest = args.includes("--allow-test");

const pool = new Pool({ connectionString: url, max: 1 });
try {
  // Always show what would change first.
  const dry = await cleanPrivateNames(pool, { allowTest });
  for (const line of reportLines(dry)) console.log(line);
  if (apply) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const typed = (await rl.question(`Type the database name (${dry.database}) to clean it: `).catch(() => "")).trim();
    rl.close();
    const done = await cleanPrivateNames(pool, { apply: true, confirm: typed, allowTest });
    for (const line of reportLines(done)) console.log(line);
  } else {
    console.log("Run again with --apply to clean.");
  }
} catch (e) {
  console.error(`clean-private-names: ${e instanceof Error ? e.message : e}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
