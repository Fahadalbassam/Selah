// Sample data for local development (fictional people and companies, never
// real client data). Usage: npm run db:seed
// One consulting firm, two client orgs, one user per role, an internal
// project and client projects with actions in every state. All users share
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

const already = await db.select({ id: s.organizations.id }).from(s.organizations).limit(1);
if (already.length > 0) {
  console.log("database already has organizations; seed skipped");
  await pool.end();
  process.exit(0);
}

async function person(email: string, name: string) {
  const existing = await ctx.internalAdapter.findUserByEmail(email);
  if (existing) return existing.user.id;
  const created = await ctx.internalAdapter.createUser({ email, name, emailVerified: true }, { method: "admin" });
  await ctx.internalAdapter.linkAccount({
    userId: created.id,
    providerId: "credential",
    accountId: created.id,
    password: await ctx.password.hash(password!),
  });
  return created.id;
}

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

const [firm] = await db
  .insert(s.organizations)
  .values({ kind: "firm", name: "Mizan Advisory", nameAr: "ميزان للاستشارات" })
  .returning();
const [nukhba] = await db
  .insert(s.organizations)
  .values({ kind: "client", name: "Al-Nukhba Holding", nameAr: "شركة النخبة القابضة" })
  .returning();
const [rawdah] = await db
  .insert(s.organizations)
  .values({ kind: "client", name: "Rawdah Foundation", nameAr: "مؤسسة الروضة" })
  .returning();

const u = {
  admin: await person("sara@mizan.example", "سارة العتيبي"),
  consultant: await person("khalid@mizan.example", "خالد الشمري"),
  consultant2: await person("noura@mizan.example", "نورة القحطاني"),
  nukhbaAdmin: await person("fahd@nukhba.example", "فهد الدوسري"),
  nukhbaManager: await person("reem@nukhba.example", "ريم الحربي"),
  nukhbaOwner: await person("abdullah@nukhba.example", "عبدالله المطيري"),
  rawdahManager: await person("hind@rawdah.example", "هند الزهراني"),
};

await db.insert(s.orgMemberships).values([
  { userId: u.admin, orgId: firm!.id, role: "firm_admin" },
  { userId: u.consultant, orgId: firm!.id, role: "consultant" },
  { userId: u.consultant2, orgId: firm!.id, role: "consultant" },
  { userId: u.nukhbaAdmin, orgId: nukhba!.id, role: "client_admin" },
  { userId: u.nukhbaManager, orgId: nukhba!.id, role: "client_manager" },
  { userId: u.nukhbaOwner, orgId: nukhba!.id, role: "action_owner" },
  { userId: u.rawdahManager, orgId: rawdah!.id, role: "client_manager" },
]);

// Each consultant leads one client.
await db.insert(s.clientAssignments).values([
  { clientOrgId: nukhba!.id, userId: u.consultant, isLead: true, assignedBy: u.admin },
  { clientOrgId: rawdah!.id, userId: u.consultant2, isLead: true, assignedBy: u.admin },
]);

const [board] = await db
  .insert(s.projects)
  .values({
    kind: "client",
    orgId: nukhba!.id,
    firmOrgId: firm!.id,
    title: "حوكمة مجلس الإدارة",
    description: "متابعة تنفيذ توصيات تقييم الحوكمة",
    state: "active",
    startDate: day(-60),
    endDate: day(90),
    createdBy: u.admin,
  })
  .returning();
const [rawdahProject] = await db
  .insert(s.projects)
  .values({ kind: "client", orgId: rawdah!.id, firmOrgId: firm!.id, title: "الخطة الاستراتيجية ٢٠٢٧", state: "active", createdBy: u.admin })
  .returning();
const [internal] = await db
  .insert(s.projects)
  .values({
    kind: "internal",
    orgId: firm!.id,
    firmOrgId: firm!.id,
    title: "تحديث منهجية التقييم الداخلية",
    description: "مشروع داخلي للشركة، لا يراه العملاء",
    state: "active",
    createdBy: u.admin,
  })
  .returning();

await db.insert(s.projectMembers).values([
  { projectId: board!.id, userId: u.nukhbaManager, addedBy: u.nukhbaAdmin },
  { projectId: board!.id, userId: u.nukhbaOwner, addedBy: u.nukhbaAdmin },
  { projectId: rawdahProject!.id, userId: u.rawdahManager, addedBy: u.admin },
  { projectId: internal!.id, userId: u.admin, isLead: true, addedBy: u.admin },
  { projectId: internal!.id, userId: u.consultant, addedBy: u.admin },
  { projectId: internal!.id, userId: u.consultant2, addedBy: u.admin },
]);

const scope = { projectId: board!.id, orgId: nukhba!.id };
const [charter, committees] = await db
  .insert(s.recommendations)
  .values([
    {
      ...scope,
      title: "اعتماد ميثاق مجلس الإدارة",
      rationale: "لا يوجد ميثاق مكتوب يحدد صلاحيات المجلس ومسؤولياته.",
      priority: "high",
      dueDate: day(30),
      requiredEvidence: "الميثاق المعتمد (PDF) ومحضر اجتماع المجلس الذي أقره",
      createdBy: u.consultant,
    },
    {
      ...scope,
      title: "تشكيل لجنة المراجعة",
      rationale: "غياب لجنة مراجعة مستقلة.",
      priority: "critical",
      dueDate: day(45),
      requiredEvidence: "قرار التشكيل وأسماء الأعضاء",
      createdBy: u.consultant,
    },
  ])
  .returning();

const act = (rec: string, title: string, status: (typeof s.actionStatus.enumValues)[number], due: number, owner = u.nukhbaOwner) => ({
  ...scope,
  recommendationId: rec,
  title,
  status,
  dueDate: day(due),
  ownerUserId: owner,
  createdBy: u.consultant,
  blockedReason: status === "blocked" ? "بانتظار موافقة المستشار القانوني" : null,
});
const created = await db
  .insert(s.actions)
  .values([
    act(charter!.id, "صياغة مسودة الميثاق", "in_progress", 10),
    act(charter!.id, "عرض المسودة على المجلس", "assigned", 25, u.nukhbaManager),
    act(charter!.id, "رفع الميثاق المعتمد", "awaiting_review", 5),
    act(committees!.id, "اختيار أعضاء اللجنة", "blocked", -3),
    act(committees!.id, "إعداد لائحة عمل اللجنة", "revision_requested", -1),
    act(committees!.id, "نشر قرار التشكيل", "verified_complete", -10, u.nukhbaManager),
  ])
  .returning();

// The verified action has its accept review on record.
await db.insert(s.reviews).values({
  ...scope,
  actionId: created[5]!.id,
  reviewerId: u.consultant,
  outcome: "accept",
  reason: "القرار موقع ومنشور.",
});

const [internalRec] = await db
  .insert(s.recommendations)
  .values({ projectId: internal!.id, orgId: firm!.id, title: "توحيد قوالب التقارير", priority: "medium", createdBy: u.admin })
  .returning();
await db.insert(s.actions).values({
  projectId: internal!.id,
  orgId: firm!.id,
  recommendationId: internalRec!.id,
  title: "إعداد قالب تقرير المتابعة",
  status: "in_progress",
  dueDate: day(14),
  ownerUserId: u.consultant2,
  createdBy: u.admin,
});

await db.insert(s.documents).values([
  {
    ...scope,
    ownerOrgId: firm!.id,
    uploadedBy: u.consultant,
    purpose: "deliverable",
    state: "submitted",
    title: "تقرير تقييم الحوكمة.pdf",
    visibility: "shared",
    storageKey: crypto.randomUUID(),
    contentType: "application/pdf",
    sizeBytes: 1024,
    sha256: "0".repeat(64),
  },
  {
    ...scope,
    ownerOrgId: firm!.id,
    uploadedBy: u.consultant,
    purpose: "deliverable",
    state: "submitted",
    title: "ملاحظات داخلية للمستشار.docx",
    visibility: "firm_private",
    storageKey: crypto.randomUUID(),
    contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    sizeBytes: 2048,
    sha256: "0".repeat(64),
  },
]);

await pool.end();
console.log("seeded. Sign in as any of:", Object.keys(u).length, "users, e.g. sara@mizan.example (firm admin), khalid@mizan.example (consultant), reem@nukhba.example (client manager)");
