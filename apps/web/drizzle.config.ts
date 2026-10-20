import { defineConfig } from "drizzle-kit";

// Migrations run as the schema owner role, never as the app role.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_OWNER_URL ?? "" },
  strict: true,
});
