// Synthetic demo data (never real client data). Usage: npm run db:seed
// Creates the Maayish org, two client orgs and one user per role, all with
// the password in SEED_PASSWORD. Refuses to run in production.
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { auth } from "@/auth/auth";
import * as s from "@/db/schema";

if (process.env.NODE_ENV === "production") throw new Error("seed refuses to run in production");
const password = process.env.SEED_PASSWORD;
if (!password || password.length < 12) throw new Error("set SEED_PASSWORD (12+ characters)");
const ownerUrl = process.env.DATABASE_OWNER_URL;
if (!ownerUrl) throw new Error("DATABASE_OWNER_URL is not set");

const pool = new Pool({ connectionString: ownerUrl, max: 1 });
const db = drizzle(pool, { schema: s });
const ctx = await auth().$context;

async function person(email: string, name: string) {
  const existing = await ctx.internalAdapter.findUserByEmail(email);
  if (existing) return existing.user.id;
  const user = await ctx.internalAdapter.createUser({ email, name, emailVerified: true }, { method: "admin" });
  await ctx.internalAdapter.linkAccount({
    userId: user.id,
    providerId: "credential",
    accountId: user.id,
    password: await ctx.password.hash(password!),
  });
  return user.id;
}

const [maayish] = await db.insert(s.organizations).values({ kind: "maayish", name: "Maayish Consulting", nameAr: "معايش للاستشارات" }).returning();
const [nukhba] = await db.insert(s.organizations).values({ kind: "client", name: "Al-Nukhba Holding (synthetic)", nameAr: "شركة النخبة القابضة (بيانات تجريبية)" }).returning();
const [rawdah] = await db.insert(s.organizations).values({ kind: "client", name: "Rawdah Foundation (synthetic)", nameAr: "مؤسسة الروضة (بيانات تجريبية)" }).returning();

const users = {
  lead: await person("lead@maayish.test", "Lead Consultant"),
  consultant: await person("consultant@maayish.test", "Consultant"),
  nukhbaAdmin: await person("admin@nukhba.test", "Nukhba Admin"),
  nukhbaManager: await person("manager@nukhba.test", "Nukhba Manager"),
  nukhbaOwner: await person("owner@nukhba.test", "Nukhba Action Owner"),
  rawdahManager: await person("manager@rawdah.test", "Rawdah Manager"),
};

await db.insert(s.orgMemberships).values([
  { userId: users.lead, orgId: maayish!.id, role: "maayish_lead" },
  { userId: users.consultant, orgId: maayish!.id, role: "consultant" },
  { userId: users.nukhbaAdmin, orgId: nukhba!.id, role: "client_admin" },
  { userId: users.nukhbaManager, orgId: nukhba!.id, role: "client_manager" },
  { userId: users.nukhbaOwner, orgId: nukhba!.id, role: "action_owner" },
  { userId: users.rawdahManager, orgId: rawdah!.id, role: "client_manager" },
]);

const [eng] = await db
  .insert(s.engagements)
  .values({ clientOrgId: nukhba!.id, maayishOrgId: maayish!.id, title: "حوكمة مجلس الإدارة", state: "active", createdBy: users.lead })
  .returning();
const [rawdahEng] = await db
  .insert(s.engagements)
  .values({ clientOrgId: rawdah!.id, maayishOrgId: maayish!.id, title: "Rawdah strategy follow-up", state: "active", createdBy: users.lead })
  .returning();

await db.insert(s.engagementMembers).values([
  { engagementId: eng!.id, userId: users.consultant, addedBy: users.lead },
  { engagementId: eng!.id, userId: users.nukhbaManager, addedBy: users.nukhbaAdmin },
  { engagementId: eng!.id, userId: users.nukhbaOwner, addedBy: users.nukhbaAdmin },
  { engagementId: rawdahEng!.id, userId: users.rawdahManager, addedBy: users.lead },
]);

const [rec] = await db
  .insert(s.recommendations)
  .values({
    engagementId: eng!.id,
    clientOrgId: nukhba!.id,
    title: "اعتماد ميثاق مجلس الإدارة",
    rationale: "No written board charter exists.",
    priority: "high",
    requiredEvidence: "Signed board charter (PDF) and board minutes approving it",
    createdBy: users.consultant,
  })
  .returning();

const [action] = await db
  .insert(s.actions)
  .values({
    engagementId: eng!.id,
    clientOrgId: nukhba!.id,
    recommendationId: rec!.id,
    title: "صياغة مسودة الميثاق",
    ownerUserId: users.nukhbaOwner,
    status: "assigned",
    dueDate: "2026-12-15",
    createdBy: users.consultant,
  })
  .returning();

await pool.end();
console.log(JSON.stringify({ engagementId: eng!.id, actionId: action!.id, users }, null, 2));
