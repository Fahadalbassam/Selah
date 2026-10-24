// Sample data for local development (fictional people and companies, never
// real client data). Usage: npm run db:seed
// One consulting firm, two client orgs, one user per role, an internal
// project and client projects with actions in every state. All users share
// the password in SEED_PASSWORD. Refuses to run in production.
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { auth } from "@/auth/auth";
import * as s from "@/db/schema";
import type { Tx } from "@/db/client";
import { answerQuestion, createAssessment, getAssessment, installStarterTemplate } from "@/services/assessments";
import { submitInquiry } from "@/services/intake";
import { PRIVACY_NOTICE_VERSION } from "@/lib/intake";

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
  .values({ kind: "firm", name: "Mizan Advisory", nameAr: "ميزان للاستشارات", allowedEmailDomains: ["mizan.example"] })
  .returning();
const [nukhba] = await db
  .insert(s.organizations)
  .values({ kind: "client", name: "Al-Nukhba Holding", nameAr: "شركة النخبة القابضة", legalForm: "closed_jsc" })
  .returning();
const [rawdah] = await db
  .insert(s.organizations)
  .values({ kind: "client", name: "Rawdah Foundation", nameAr: "مؤسسة الروضة", legalForm: "non_profit" })
  .returning();
// A family office that does not use Selah: the firm records its progress.
const [waha] = await db
  .insert(s.organizations)
  .values({ kind: "client", name: "Al-Waha Family Office", nameAr: "مكتب الواحة العائلي", engagementMode: "consultant_managed", legalForm: "llc" })
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
  { clientOrgId: waha!.id, userId: u.consultant, isLead: true, assignedBy: u.admin },
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
const [wahaProject] = await db
  .insert(s.projects)
  .values({ kind: "client", orgId: waha!.id, firmOrgId: firm!.id, title: "حوكمة الشركة العائلية", state: "active", createdBy: u.admin })
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
  { projectId: wahaProject!.id, userId: u.consultant, isLead: true, addedBy: u.admin },
  { projectId: wahaProject!.id, userId: u.consultant2, addedBy: u.admin },
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

// Every action past "in progress" has the evidence its state implies (review
// M13): the one awaiting review and the one sent back each have a submitted
// file, the one sent back has the consultant's reason, and the verified one
// has the file its accept review covers.
const evidenceFor = async (actionId: string, title: string, by: string) => {
  const [doc] = await db
    .insert(s.documents)
    .values({
      ...scope,
      ownerOrgId: nukhba!.id,
      uploadedBy: by,
      purpose: "evidence",
      state: "submitted",
      title,
      visibility: "shared",
      storageKey: crypto.randomUUID(),
      contentType: "application/pdf",
      sizeBytes: 1024,
      sha256: "0".repeat(64),
      scanStatus: "clean",
    })
    .returning();
  const [sub] = await db.insert(s.evidenceSubmissions).values({ ...scope, actionId, documentId: doc!.id, submittedBy: by }).returning();
  return { doc: doc!, sub: sub! };
};
await evidenceFor(created[2]!.id, "الميثاق المعتمد.pdf", u.nukhbaOwner);
const sentBack = await evidenceFor(created[4]!.id, "مسودة لائحة اللجنة.pdf", u.nukhbaOwner);
await db.insert(s.reviews).values({
  ...scope,
  actionId: created[4]!.id,
  reviewerId: u.consultant,
  outcome: "revise",
  reason: "اللائحة لا تذكر صلاحيات اللجنة ولا دورية اجتماعاتها.",
  evidenceSubmissionId: sentBack.sub.id,
  evidenceSubmissionIds: [sentBack.sub.id],
  evidenceSha256: [sentBack.doc.sha256],
});
const published = await evidenceFor(created[5]!.id, "قرار التشكيل المنشور.pdf", u.nukhbaManager);
await db.insert(s.reviews).values({
  ...scope,
  actionId: created[5]!.id,
  reviewerId: u.consultant,
  outcome: "accept",
  reason: "القرار موقع ومنشور.",
  evidenceSubmissionId: published.sub.id,
  evidenceSubmissionIds: [published.sub.id],
  evidenceSha256: [published.doc.sha256],
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

const [wahaRec] = await db
  .insert(s.recommendations)
  .values({ projectId: wahaProject!.id, orgId: waha!.id, title: "ميثاق العائلة", priority: "high", createdBy: u.consultant })
  .returning();
await db.insert(s.actions).values({
  projectId: wahaProject!.id,
  orgId: waha!.id,
  recommendationId: wahaRec!.id,
  title: "صياغة ميثاق العائلة",
  status: "in_progress",
  dueDate: day(20),
  ownerName: "ماجد الواحي (مدير المكتب)",
  createdBy: u.consultant,
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
    scanStatus: "clean",
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
    scanStatus: "clean",
  },
]);

// The kickoff request list for the board project: some from the starting
// list, one of the firm's own, one already sent by the client.
const requested = await db
  .insert(s.infoRequests)
  .values([
    { ...scope, area: "legal", templateKey: "legal.articles", title: "Articles of association and their amendments", ownerUserId: u.nukhbaAdmin, dueDate: day(7), createdBy: u.consultant },
    { ...scope, area: "governance", templateKey: "governance.board_charter", title: "Board charter and committee charters", ownerUserId: u.nukhbaManager, dueDate: day(-3), createdBy: u.consultant },
    { ...scope, area: "governance", templateKey: "governance.minutes", title: "Board minutes for the last two years", sensitivity: "confidential", ownerUserId: u.nukhbaAdmin, dueDate: day(10), createdBy: u.consultant },
    { ...scope, area: "governance", title: "محاضر الجمعية العامة الأخيرة", description: "آخر جمعيتين عاديتين وأي جمعية غير عادية", ownerUserId: u.nukhbaManager, createdBy: u.consultant },
  ])
  .returning({ id: s.infoRequests.id });
const [sentFile] = await db
  .insert(s.documents)
  .values({
    ...scope,
    ownerOrgId: nukhba!.id,
    uploadedBy: u.nukhbaManager,
    purpose: "client_document",
    state: "submitted",
    title: "لائحة مجلس الإدارة.pdf",
    visibility: "shared",
    storageKey: crypto.randomUUID(),
    contentType: "application/pdf",
    sizeBytes: 1024,
    sha256: "0".repeat(64),
    scanStatus: "clean",
  })
  .returning({ id: s.documents.id });
await db.insert(s.infoRequestFiles).values({ requestId: requested[1]!.id, documentId: sentFile!.id, attachedBy: u.nukhbaManager });

// The starter governance template, published, with Khalid as an author, and
// a baseline assessment of Al-Nukhba under way.
await db.insert(s.templateAuthors).values({ firmOrgId: firm!.id, userId: u.consultant, grantedBy: u.admin });
const adminPrincipal = {
  userId: u.admin,
  orgId: firm!.id,
  orgKind: "firm" as const,
  role: "firm_admin" as const,
  projectIds: new Set<string>(),
  assignedClientIds: new Set<string>(),
  leadClientIds: new Set<string>(),
  leadProjectIds: new Set<string>(),
  departmentIds: new Set<string>(),
};
const tx = db as unknown as Tx;
const starter = await installStarterTemplate(tx, adminPrincipal, { publish: true });
const baseline = await createAssessment(tx, adminPrincipal, board!.id, { templateId: starter.id, title: "التقييم المبدئي ٢٠٢٦" });
const seeded = await getAssessment(tx, adminPrincipal, baseline.id);
const sample: Record<string, string> = { "0.1": "family", "1.1": "yes", "1.2": "partly", "1.3": "no", "2.1": "no", "2.2": "informal", "4.1": "partly", "4.3": "2" };
for (const q of seeded.sections.flatMap((x) => x.questions)) {
  if (q.ref && sample[q.ref]) await answerQuestion(tx, adminPrincipal, q.answer.id, { value: sample[q.ref]! });
}

// Two inquiries from the public form, waiting in the firm's inbox.
const no = { hasStrategy: false, hasOrgChart: true, hasDelegationMatrix: false, hasPolicies: false, hasSops: false, hasKpis: false };
const inquiry = { consent: true as const, marketingConsent: false, privacyNoticeVersion: PRIVACY_NOTICE_VERSION, selfCheck: no };
await submitInquiry(
  tx,
  {
    ...inquiry,
    orgName: "Al-Fajr Trading Co.",
    orgNameAr: "شركة الفجر التجارية",
    sector: "trade_distribution",
    employeeBand: "50-249",
    ownershipType: "family_multi_partner",
    familyGeneration: "second",
    familyWorking: "4-10",
    familyGovernance: "none",
    contactName: "سلمان الدوسري",
    requesterRole: "ceo",
    contactRole: "General manager",
    email: "salman@alfajr.example",
    phone: "+966 55 123 4567",
    contactChannel: "whatsapp",
    preferredLanguage: "ar",
    services: ["family_business_governance", "delegation_matrix"],
    whyNow: "The founder plans to hand over to the second generation next year.",
    message: "The second generation is joining the business and we want clear rules before then.",
    urgency: "within_3_months",
    heardFrom: "referral",
  },
  null,
  null,
);
await submitInquiry(
  tx,
  {
    ...inquiry,
    orgName: "Bayan Training Institute",
    sector: "training",
    employeeBand: "10-49",
    ownershipType: "llc",
    contactName: "Mona Al-Harbi",
    requesterRole: "executive",
    email: "mona@bayan.example",
    contactChannel: "email",
    preferredLanguage: "en",
    services: ["strategic_plan"],
    whyNow: "Our three-year plan ends in June and the board wants the next one ready.",
    urgency: "exploring",
  },
  null,
  null,
);

await pool.end();
console.log("seeded. Sign in as any of:", Object.keys(u).length, "users, e.g. sara@mizan.example (firm admin), khalid@mizan.example (consultant), reem@nukhba.example (client manager)");
