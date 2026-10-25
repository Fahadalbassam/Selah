// The walkthrough data: one sign-in per role on both sides and three cases
// with every state, for showing Selah to a team on a local machine (fictional
// people and companies, never real client data). Usage, on an empty database:
//
//   npm run db:seed:walkthrough
//
// Almost everything is done the way the app does it: each step runs as the
// person who would take it, through the same services, row-level security and
// database rules as the screens. So the history, notifications, mail and
// audit trail are real, and no record is in a state the app could not reach.
// The only direct writes are the accounts themselves and a few dates moved
// into the past (a step taken today can't be weeks late otherwise).
//
// Every account shares WALKTHROUGH_PASSWORD (default in docs/walkthrough.md).
// Local sample data only: refuses to run in production.
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { auth } from "@/auth/auth";
import * as schema from "@/db/schema";
import type { Tx } from "@/db/client";
import type { Principal } from "@/authz";
import { CLIENT_AI_VERSION } from "@/lib/client-ai";
import { PRIVACY_NOTICE_VERSION } from "@/lib/intake";
import { firmToday } from "@/lib/dates";
import { LEGAL_VERSIONS } from "@/lib/legal";
import { createContact } from "@/services/accounts";
import { transitionAction } from "@/services/actions";
import { answerQuestion, createAssessment, getAssessment, installStarterTemplate, setLegalForm } from "@/services/assessments";
import { recordCaseStudyConsent } from "@/services/case-study";
import { consentClientAi, setClientAi } from "@/services/client-ai";
import { addMember, createGroup, grantViewer, setHolding } from "@/services/client-groups";
import { setClientProfile } from "@/services/client-profile";
import { addClientRole } from "@/services/client-roles";
import { disposeAction, moveClosure, requestClosure, writeLessons } from "@/services/closure";
import { postComment } from "@/services/comments";
import { createDepartment, putDepartmentMember, setEngagement, setShortNames } from "@/services/engagement";
import { recordEngagement } from "@/services/engagements";
import { prepareUpload, submitEvidence } from "@/services/evidence";
import { putProfile } from "@/services/expertise";
import { setAssistantFlag } from "@/services/documents";
import { uploadProjectDocument } from "@/services/files";
import {
  addActionNote,
  addEvidenceRequest,
  decideDeadlineChange,
  decideEvidenceRequest,
  requestDeadlineChange,
  shareReport,
  signRiskAcceptance,
  snapshotReport,
} from "@/services/follow-through";
import { reportProblem } from "@/services/help";
import { addValue, createIndicator, linkRecommendation } from "@/services/indicators";
import { addTemplateItems, answerWithUpload, createInfoRequest } from "@/services/info-requests";
import { submitInquiry } from "@/services/intake";
import { addFollowUp, bookMeeting, recordDecision, saveSummary, sendInvites, updateFollowUp, updateMeeting } from "@/services/meetings";
import { createAction, createFinding, createRecommendation } from "@/services/plan";
import { loadPrincipal } from "@/services/principal";
import { addProgressUpdate } from "@/services/progress";
import { startPitch } from "@/services/prospects";
import { recordResponse } from "@/services/responses";
import { setClientReviewRule, signOff } from "@/services/second-review";
import {
  addConsultant,
  addProjectPerson,
  createClient,
  createClientProject,
  createInternalProject,
  requestToJoin,
  setDeputy,
  setLead,
  staffProject,
} from "@/services/staffing";
import * as F from "./files";

if (process.env.NODE_ENV === "production") throw new Error("the walkthrough seed refuses to run in production");
const password = process.env.WALKTHROUGH_PASSWORD || "123456789@Pass";
const ownerUrl = process.env.DATABASE_OWNER_URL;
const appUrl = process.env.DATABASE_APP_URL;
if (!ownerUrl || !appUrl) throw new Error("DATABASE_OWNER_URL and DATABASE_APP_URL must be set");

const owner = new Pool({ connectionString: ownerUrl, max: 2 });
const app = new Pool({ connectionString: appUrl, max: 2 });
const ownerDb = drizzle(owner, { schema });
const ctx = await auth().$context;

const already = await owner.query(`SELECT 1 FROM organizations LIMIT 1`);
if (already.rowCount) {
  const mine = await owner.query(`SELECT 1 FROM "user" WHERE email = 'admin@mizan.test'`);
  console.log(
    mine.rowCount
      ? "the walkthrough data is already loaded; nothing to do"
      : "this database already has other sample data. Start from an empty one: npm run walkthrough -- --fresh",
  );
  await Promise.all([owner.end(), app.end()]);
  process.exit(mine.rowCount ? 0 : 1);
}

// ---------------------------------------------------------------- helpers

/** Run `fn` as `userId`, the way a request does: one transaction, their RLS identity, their principal. */
async function as<T>(userId: string, fn: (tx: Tx, p: Principal) => Promise<T>): Promise<T> {
  const c = await app.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT set_config('selah.user_id', $1, true)", [userId]);
    const tx = drizzle(c, { schema }) as unknown as Tx;
    const principal = await loadPrincipal(tx, userId);
    if (!principal) throw new Error(`no principal for ${userId}`);
    const out = await fn(tx, principal);
    await c.query("COMMIT");
    return out;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
const sql = (text: string, params: unknown[] = []) => owner.query(text, params);

const today = firmToday();
const day = (offset: number) => {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};
/** A time `offset` days from today at hh:mm Riyadh time. */
const at = (offset: number, hh: number, mm = 0) => new Date(`${day(offset)}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00+03:00`);
const monthStart = (back: number) => {
  const d = new Date(`${today}T00:00:00Z`);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - back, 1)).toISOString().slice(0, 10);
};

/** A checked file, as the upload route builds it. CLAMD_HOST empty locally: stored as "skipped". */
const upload = (userId: string, target: { type: "action" | "project" | "info_request"; id: string }, f: F.SeedFile) =>
  prepareUpload(userId, target, new File([f.bytes.slice()], f.name, { type: f.type }));

async function person(email: string, name: string, nameAlt: string) {
  const created = await ctx.internalAdapter.createUser({ email, name, emailVerified: true }, { method: "admin" });
  await ctx.internalAdapter.linkAccount({ userId: created.id, providerId: "credential", accountId: created.id, password: await ctx.password.hash(password) });
  // The name in the other language: shown to English readers, and masked before a hosted model.
  await sql(`UPDATE "user" SET name_alt = $2 WHERE id = $1`, [created.id, nameAlt]);
  return created.id;
}

/** Moves an action's due date into the past: the step happened weeks ago. */
const backdateDue = (actionId: string, due: string) => sql(`UPDATE actions SET due_date = $2 WHERE id = $1`, [actionId, due]);

const step = (msg: string) => console.log(`  - ${msg}`);

// ---------------------------------------------------------------- the firm and its people

console.log("walkthrough seed:");
step("the firm and its people");
const [firm] = await ownerDb
  .insert(schema.organizations)
  .values({ kind: "firm", name: "Mizan Advisory", nameAr: "ميزان للاستشارات", allowedEmailDomains: ["mizan.test"] })
  .returning({ id: schema.organizations.id });
const FIRM = firm!.id;

const U = {
  admin: await person("admin@mizan.test", "سارة العتيبي", "Sara Al-Otaibi"),
  lead: await person("lead@mizan.test", "خالد الشمري", "Khalid Al-Shammari"),
  deputy: await person("deputy@mizan.test", "نورة القحطاني", "Noura Al-Qahtani"),
  consultant: await person("consultant@mizan.test", "عمر الزهراني", "Omar Al-Zahrani"),
  observer: await person("observer@mizan.test", "ليلى الحربي", "Layla Al-Harbi"),
  lead2: await person("lead2@mizan.test", "ماجد السبيعي", "Majed Al-Subaie"),
};
await ownerDb.insert(schema.orgMemberships).values([
  { userId: U.admin, orgId: FIRM, role: "firm_admin" },
  { userId: U.lead, orgId: FIRM, role: "consultant" },
  { userId: U.deputy, orgId: FIRM, role: "consultant" },
  { userId: U.consultant, orgId: FIRM, role: "consultant" },
  { userId: U.observer, orgId: FIRM, role: "consultant" },
  { userId: U.lead2, orgId: FIRM, role: "consultant" },
]);

// What each consultant covers (Team > Expertise, and the lead suggestions on a new client).
const profiles: [string, string[], string[]][] = [
  [U.lead, ["corporate_governance", "family_business_governance"], ["trade_distribution", "services"]],
  [U.deputy, ["corporate_governance", "delegation_matrix"], ["contracting", "services"]],
  [U.consultant, ["policies_sops", "org_structure"], ["retail"]],
  [U.observer, ["operational_plan"], []],
  [U.lead2, ["strategic_plan", "family_business_governance"], ["non_profit", "training"]],
];
for (const [userId, services, sectors] of profiles) {
  await as(U.admin, (tx, p) => putProfile(tx, p, userId, { languages: ["ar", "en"], acceptingNewClients: userId !== U.lead, services, sectors }));
}

// ---------------------------------------------------------------- clients

step("clients, their people and their consultants");
const nukhba = await as(U.admin, (tx, p) => createClient(tx, p, { name: "Al-Nukhba Holding", nameAr: "شركة النخبة القابضة" }));
const rawdah = await as(U.admin, (tx, p) => createClient(tx, p, { name: "Rawdah Foundation", nameAr: "مؤسسة الروضة" }));
// A family office with no accounts: the firm records its progress for it.
const waha = await as(U.admin, (tx, p) => createClient(tx, p, { name: "Al-Waha Family Office", nameAr: "مكتب الواحة العائلي", engagementMode: "consultant_managed" }));
// A subsidiary of Al-Nukhba, also run by the firm, so the group roll-up has two members.
const nukhbaRe = await as(U.admin, (tx, p) =>
  createClient(tx, p, { name: "Al-Nukhba Real Estate Development", nameAr: "النخبة للتطوير العقاري", engagementMode: "consultant_managed" }),
);
await as(U.admin, (tx, p) => setLegalForm(tx, p, nukhba.id, "closed_jsc"));
await as(U.admin, (tx, p) => setLegalForm(tx, p, rawdah.id, "non_profit"));
await as(U.admin, (tx, p) => setLegalForm(tx, p, waha.id, "llc"));
await as(U.admin, (tx, p) => setShortNames(tx, p, nukhba.id, "النخبة، Al-Nukhba"));
await as(U.admin, (tx, p) => setShortNames(tx, p, rawdah.id, "الروضة، Rawdah"));
await as(U.admin, (tx, p) => setShortNames(tx, p, waha.id, "الواحة، Al-Waha"));
await as(U.admin, (tx, p) =>
  setClientProfile(tx, p, nukhba.id, {
    legalNameAr: "شركة النخبة القابضة (شركة مساهمة مقفلة)",
    legalNameEn: "Al-Nukhba Holding Company (closed joint stock)",
    tradeName: "النخبة",
    unifiedNumber: "7001234567",
    isicCode: "642000",
    sectorCode: "services",
    sizeBand: "large",
    revenueBand: "large",
    region: "riyadh",
    regulators: ["mc"],
    listedMarket: null,
    fiscalYearEndMonth: 12,
    fiscalCalendar: "gregorian",
  }),
);
await sql(`UPDATE organizations SET allowed_email_domains = $2 WHERE id = $1`, [nukhba.id, ["nukhba.test"]]);
await sql(`UPDATE organizations SET allowed_email_domains = $2 WHERE id = $1`, [rawdah.id, ["rawdah.test"]]);

const C = {
  nAdmin: await person("admin@nukhba.test", "فهد الدوسري", "Fahd Al-Dosari"),
  nSponsor: await person("sponsor@nukhba.test", "منصور العنزي", "Mansour Al-Anazi"),
  nManager: await person("manager@nukhba.test", "ريم الحربي", "Reem Al-Harbi"),
  nOwner: await person("owner@nukhba.test", "عبدالله المطيري", "Abdullah Al-Mutairi"),
  nOwner2: await person("finance@nukhba.test", "سلمى الشهري", "Salma Al-Shehri"),
  rAdmin: await person("admin@rawdah.test", "هند الزهراني", "Hind Al-Zahrani"),
  rManager: await person("manager@rawdah.test", "يوسف الغامدي", "Yousef Al-Ghamdi"),
  rOwner: await person("owner@rawdah.test", "دانة العمري", "Dana Al-Omari"),
};
await ownerDb.insert(schema.orgMemberships).values([
  { userId: C.nAdmin, orgId: nukhba.id, role: "client_admin" },
  { userId: C.nSponsor, orgId: nukhba.id, role: "client_manager" },
  { userId: C.nManager, orgId: nukhba.id, role: "client_manager" },
  { userId: C.nOwner, orgId: nukhba.id, role: "action_owner" },
  { userId: C.nOwner2, orgId: nukhba.id, role: "action_owner" },
  { userId: C.rAdmin, orgId: rawdah.id, role: "client_admin" },
  { userId: C.rManager, orgId: rawdah.id, role: "client_manager" },
  { userId: C.rOwner, orgId: rawdah.id, role: "action_owner" },
]);

// The client teams: Khalid leads Al-Nukhba with Noura as deputy and Omar on
// the team; Majed leads Rawdah and the two firm-run clients.
for (const [client, consultants] of [
  [nukhba.id, [U.lead, U.deputy, U.consultant, U.observer]],
  [rawdah.id, [U.lead2]],
  [waha.id, [U.lead2]],
  [nukhbaRe.id, [U.deputy]],
] as const) {
  for (const c of consultants) await as(U.admin, (tx, p) => addConsultant(tx, p, client, c));
}
await as(U.admin, (tx, p) => setLead(tx, p, nukhba.id, U.lead));
await as(U.admin, (tx, p) => setDeputy(tx, p, nukhba.id, U.deputy));
await as(U.admin, (tx, p) => setLead(tx, p, rawdah.id, U.lead2));
await as(U.admin, (tx, p) => setLead(tx, p, waha.id, U.lead2));
await as(U.admin, (tx, p) => setLead(tx, p, nukhbaRe.id, U.deputy));

// Omar asks to join the Rawdah team; the request waits for the firm admin.
await as(U.consultant, (tx, p) => requestToJoin(tx, p, rawdah.id, "عملت مع الروضة على خطتها السابقة وأعرف فريقها التنفيذي."));

// Al-Nukhba works by department; the people head or sit in each.
await as(U.admin, (tx, p) => setEngagement(tx, p, nukhba.id, { departmentsEnabled: true }));
const dept = {
  legal: await as(C.nAdmin, (tx, p) => createDepartment(tx, p, nukhba.id, { nameAr: "الشؤون القانونية", nameEn: "Legal affairs" })),
  finance: await as(C.nAdmin, (tx, p) => createDepartment(tx, p, nukhba.id, { nameAr: "الإدارة المالية", nameEn: "Finance" })),
  secretariat: await as(C.nAdmin, (tx, p) => createDepartment(tx, p, nukhba.id, { nameAr: "أمانة مجلس الإدارة", nameEn: "Board secretariat" })),
};
await as(C.nAdmin, (tx, p) => putDepartmentMember(tx, p, dept.legal.id, C.nOwner, { isHead: true }));
await as(C.nAdmin, (tx, p) => putDepartmentMember(tx, p, dept.finance.id, C.nOwner2, { isHead: true }));
await as(C.nAdmin, (tx, p) => putDepartmentMember(tx, p, dept.secretariat.id, C.nManager, { isHead: true }));
// A manager sees company-wide work and their departments' (docs/authorization.md): the CEO sits in two.
await as(C.nAdmin, (tx, p) => putDepartmentMember(tx, p, dept.secretariat.id, C.nSponsor, { isHead: false }));
await as(C.nAdmin, (tx, p) => putDepartmentMember(tx, p, dept.finance.id, C.nSponsor, { isHead: false }));

// A person at the client without an account: the external auditor.
const auditor = await as(U.lead, (tx, p) =>
  createContact(tx, p, nukhba.id, { name: "ماجد السليمان", nameAlt: "Majed Al-Sulaiman", title: "المراجع الخارجي (سليمان وشركاه)", email: "majed@sulaiman.test" }),
);

// ---------------------------------------------------------------- case 1: Al-Nukhba board governance

step("case 1: Al-Nukhba, board governance (every action state)");
const board = await as(U.lead, (tx, p) =>
  createClientProject(tx, p, nukhba.id, {
    title: "حوكمة مجلس الإدارة",
    description: "متابعة تنفيذ توصيات تقييم الحوكمة: ميثاق المجلس، لجنة المراجعة، مصفوفة الصلاحيات، وتعارض المصالح.",
    startDate: day(-75),
    endDate: day(105),
  }),
);
await as(U.admin, (tx, p) =>
  recordEngagement(tx, p, nukhba.id, {
    title: "اتفاقية خدمات استشارات الحوكمة ٢٠٢٦",
    signedOn: day(-80),
    contractRef: "MZ-2026-014",
    scope: "تقييم الحوكمة ومتابعة تنفيذ التوصيات لمدة ستة أشهر.",
    exclusions: "لا يشمل الأعمال القانونية أو المراجعة المالية.",
    dataAgreementOn: day(-80),
    startsOn: day(-75),
    endsOn: day(105),
    projectIds: [board.id],
  }),
);
await as(U.lead, (tx, p) => staffProject(tx, p, board.id, U.consultant));
await as(U.lead, (tx, p) => staffProject(tx, p, board.id, U.deputy));
await as(U.admin, (tx, p) => staffProject(tx, p, board.id, U.observer, true));
for (const c of [C.nAdmin, C.nSponsor, C.nManager, C.nOwner, C.nOwner2]) await as(U.lead, (tx, p) => addProjectPerson(tx, p, board.id, c));
await as(U.lead, (tx, p) => addClientRole(tx, p, board.id, { role: "sponsor", person: `user:${C.nSponsor}` }));
await as(U.lead, (tx, p) => addClientRole(tx, p, board.id, { role: "coordinator", person: `user:${C.nManager}` }));
await as(U.lead, (tx, p) => addClientRole(tx, p, board.id, { role: "observer", person: `contact:${auditor.id}` }));

// Files the firm shares, and its own notes (firm only).
const boardDocs: Record<string, string> = {};
for (const [key, f] of Object.entries(F.nukhbaLibrary)) {
  const file = await upload(U.lead, { type: "project", id: board.id }, f);
  boardDocs[key] = (await as(U.lead, (tx, p) => uploadProjectDocument(tx, p, board.id, { file, visibility: "shared" }))).id;
}
{
  const file = await upload(U.lead, { type: "project", id: board.id }, F.nukhbaPrivateNotes);
  await as(U.lead, (tx, p) => uploadProjectDocument(tx, p, board.id, { file, visibility: "firm_private" }));
}

// The plan: findings, the recommendations they lead to, and the actions.
const fnd = {
  charter: await as(U.lead, (tx, p) => createFinding(tx, p, board.id, { title: "لا يوجد ميثاق مكتوب لمجلس الإدارة", description: "تقرير التقييم، الملاحظة 1", visibility: "shared" })),
  audit: await as(U.lead, (tx, p) => createFinding(tx, p, board.id, { title: "لا توجد لجنة مراجعة مستقلة", description: "محضر المجلس رقم 14 قرر تشكيلها", visibility: "shared" })),
  doa: await as(U.lead, (tx, p) => createFinding(tx, p, board.id, { title: "حدود الصلاحيات المالية مرتفعة", description: "مصفوفة 2024 تسمح بمليون ريال دون المجلس", visibility: "shared" })),
};
const rec = {
  charter: await as(U.lead, (tx, p) =>
    createRecommendation(tx, p, board.id, {
      title: "اعتماد ميثاق مجلس الإدارة",
      findingId: fnd.charter.id,
      rationale: "لا يوجد ميثاق مكتوب يحدد صلاحيات المجلس ومسؤولياته وآلية تقييمه.",
      targetOutcome: "ميثاق معتمد ومنشور يعمل به المجلس من الدورة القادمة.",
      priority: "high",
      dueDate: day(30),
      requiredEvidence: "الميثاق المعتمد ومحضر اجتماع المجلس الذي أقره",
      source: "consultant",
      visibility: "shared",
      departmentId: dept.secretariat.id,
      accountableUserId: C.nManager,
    }),
  ),
  audit: await as(U.lead, (tx, p) =>
    createRecommendation(tx, p, board.id, {
      title: "تشكيل لجنة المراجعة",
      findingId: fnd.audit.id,
      rationale: "غياب لجنة مراجعة مستقلة تشرف على المراجع الخارجي والرقابة الداخلية.",
      priority: "critical",
      dueDate: day(20),
      requiredEvidence: "قرار التشكيل وأسماء الأعضاء ولائحة عمل اللجنة",
      source: "board_decision",
      decidedOn: day(-60),
      visibility: "shared",
      accountableUserId: C.nAdmin,
    }),
  ),
  doa: await as(U.lead, (tx, p) =>
    createRecommendation(tx, p, board.id, {
      title: "تحديث مصفوفة تفويض الصلاحيات",
      findingId: fnd.doa.id,
      rationale: "الحدود الحالية تسمح بنفقات كبيرة دون رقابة المجلس.",
      priority: "medium",
      dueDate: day(45),
      requiredEvidence: "المصفوفة المحدثة المعتمدة من المجلس",
      source: "consultant",
      visibility: "shared",
      departmentId: dept.finance.id,
      accountableUserId: C.nOwner2,
    }),
  ),
  coi: await as(U.lead, (tx, p) =>
    createRecommendation(tx, p, board.id, {
      title: "تفعيل سجل إفصاحات تعارض المصالح",
      rationale: "السياسة GOV-POL-07 معتمدة لكن السجل غير محدث.",
      priority: "medium",
      dueDate: day(-5),
      requiredEvidence: "السجل المحدث بإفصاحات جميع الأعضاء",
      source: "compliance",
      visibility: "shared",
      departmentId: dept.legal.id,
    }),
  ),
};

const release = (recId: string, title: string, ownerUserId: string, due: number, extra: { description?: string; departmentId?: string; evidence?: { title: string }[] } = {}) =>
  as(U.lead, (tx, p) => createAction(tx, p, recId, { title, ownerUserId, dueDate: day(due), release: true, ...extra }));

const A = {
  // Verified complete, after two sign-offs (the client's rule: high priority work needs a second consultant).
  draft: await release(rec.charter.id, "صياغة مسودة الميثاق", C.nManager, 15, { departmentId: dept.secretariat.id, evidence: [{ title: "مسودة الميثاق النهائية" }] }),
  // Awaiting review: the first sign-off is in, the second is waiting.
  present: await release(rec.charter.id, "عرض المسودة على المجلس واعتمادها", C.nManager, 20, { departmentId: dept.secretariat.id }),
  // Assigned, not started.
  publish: await release(rec.charter.id, "نشر الميثاق المعتمد على موقع الشركة", C.nOwner, 35),
  // Blocked, and overdue.
  members: await release(rec.audit.id, "ترشيح الأعضاء المستقلين للجنة", C.nSponsor, 10),
  // Revision requested: the bylaws were sent back with a reason.
  bylaws: await release(rec.audit.id, "إعداد لائحة عمل اللجنة", C.nOwner, 12, { departmentId: dept.legal.id, evidence: [{ title: "اللائحة متضمنة الصلاحيات ودورية الاجتماعات" }] }),
  // In progress, overdue, with a request to move the date waiting for the firm.
  limits: await release(rec.doa.id, "مراجعة حدود الصلاحيات المالية", C.nOwner2, 10, { departmentId: dept.finance.id }),
  // In progress with an evidence list and progress notes; its date was already moved once.
  matrix: await release(rec.doa.id, "تحديث مصفوفة الصلاحيات ورفعها للمجلس", C.nOwner2, 40, {
    departmentId: dept.finance.id,
    evidence: [{ title: "المصفوفة المحدثة" }, { title: "مذكرة المقارنة مع الحدود الحالية" }],
  }),
  // Closed: the client signed a risk acceptance for the two missing disclosures.
  disclosures: await release(rec.coi.id, "جمع إقرارات الأعضاء لعام 2026", C.nOwner, 20, { departmentId: dept.legal.id }),
};
// Still a draft: the firm is preparing it (clients can read drafts too, by design).
await as(U.lead, (tx, p) =>
  createAction(tx, p, rec.audit.id, { title: "اعتماد قرار تشكيل اللجنة ونشره", ownerUserId: C.nAdmin, dueDate: day(25), release: false }),
);

// The client's rule for a second sign-off (F22): high-priority work.
await as(U.admin, (tx, p) => setClientReviewRule(tx, p, nukhba.id, "high_priority"));

const start = (actionId: string, userId: string) => as(userId, (tx, p) => transitionAction(tx, p, actionId, { to: "in_progress" }));
const send = async (actionId: string, userId: string, f: F.SeedFile, opts: { note?: string; submitForReview?: boolean } = {}) => {
  const file = await upload(userId, { type: "action", id: actionId }, f);
  return as(userId, (tx, p) => submitEvidence(tx, p, actionId, { file, note: opts.note, submitForReview: opts.submitForReview ?? true }));
};

/** The reviewer accepts each item on the action's evidence list that a file answers. */
const acceptItems = async (actionId: string, userId: string) => {
  const items = await sql(`SELECT id FROM evidence_requests WHERE action_id = $1 AND status = 'submitted'`, [actionId]);
  for (const r of items.rows) await as(userId, (tx, p) => decideEvidenceRequest(tx, p, r.id, { status: "accepted" }));
};

// The draft charter: sent, signed off by Omar, verified by Khalid.
await start(A.draft.id, C.nManager);
await as(C.nManager, (tx, p) => addProgressUpdate(tx, p, A.draft.id, "أنهينا المسودة الثالثة بعد ملاحظات رئيس المجلس."));
await send(A.draft.id, C.nManager, F.nukhbaEvidence.charterDraft, { note: "المسودة الثالثة بعد ملاحظات الرئيس" });
await acceptItems(A.draft.id, U.consultant);
await as(U.consultant, (tx, p) => signOff(tx, p, A.draft.id, "المسودة تغطي التكوين والصلاحيات والاجتماعات والتقييم."));
await as(U.lead, (tx, p) => transitionAction(tx, p, A.draft.id, { to: "verified_complete" }));

// The board's approval: sent; Omar's first sign-off is in, the second waits for Khalid or Noura.
await start(A.present.id, C.nManager);
await send(A.present.id, C.nManager, F.nukhbaEvidence.boardPresentation, { note: "محضر الاجتماع رقم 16" });
await as(U.consultant, (tx, p) => signOff(tx, p, A.present.id, "المحضر يثبت الاعتماد؛ ينقص توقيع الرئيس على النسخة النهائية."));
await as(U.consultant, (tx, p) =>
  postComment(tx, p, A.present.id, { body: "شكراً ريم. هل يمكن إرفاق النسخة الموقعة من الرئيس أيضاً؟ نحتاجها للتحقق الثاني.", mentions: [C.nManager] }),
);
await as(C.nManager, (tx, p) => postComment(tx, p, A.present.id, { body: "سأرفعها بعد توقيع الرئيس يوم الأحد إن شاء الله." }));

// The independent members: blocked, now past its date.
await start(A.members.id, C.nSponsor);
await as(C.nSponsor, (tx, p) => transitionAction(tx, p, A.members.id, { to: "blocked", reason: "بانتظار موافقة الجمعية العامة على مكافآت الأعضاء المستقلين" }));
await backdateDue(A.members.id, day(-6));

// The committee bylaws: sent, then sent back with a reason.
await start(A.bylaws.id, C.nOwner);
await send(A.bylaws.id, C.nOwner, F.nukhbaEvidence.committeeBylaws);
await as(U.consultant, (tx, p) =>
  transitionAction(tx, p, A.bylaws.id, { to: "revision_requested", reason: "اللائحة لا تذكر صلاحيات اللجنة ولا دورية اجتماعاتها ولا علاقتها بالمراجع الخارجي." }),
);
await as(C.nOwner, (tx, p) => postComment(tx, p, A.bylaws.id, { body: "واضح، سنضيف فصلاً للصلاحيات ونحدد أربعة اجتماعات في السنة." }));
await backdateDue(A.bylaws.id, day(-2));

// The financial limits: started late; the owner asks for two more weeks.
await start(A.limits.id, C.nOwner2);
await as(C.nOwner2, (tx, p) => addProgressUpdate(tx, p, A.limits.id, "جمعنا حدود خمس شركات مماثلة، وننتظر رد الرئيس التنفيذي على المقترح."));
await backdateDue(A.limits.id, day(-4));
await as(C.nOwner2, (tx, p) => requestDeadlineChange(tx, p, A.limits.id, { proposedDueDate: day(12), reason: "الرئيس التنفيذي مسافر حتى نهاية الأسبوع القادم." }));

// The matrix: its date was moved once (approved), and one of its two items is answered.
await start(A.matrix.id, C.nOwner2);
await as(C.nOwner2, (tx, p) => requestDeadlineChange(tx, p, A.matrix.id, { proposedDueDate: day(50), reason: "ننتظر نتيجة مراجعة الحدود المالية قبل تحديث المصفوفة." }));
{
  const pending = await sql(`SELECT id FROM deadline_change_requests WHERE action_id = $1 ORDER BY created_at DESC LIMIT 1`, [A.matrix.id]);
  await as(U.lead, (tx, p) => decideDeadlineChange(tx, p, pending.rows[0].id, { approve: true }));
}
await send(A.matrix.id, C.nOwner2, F.nukhbaEvidence.doaLimits, { submitForReview: false, note: "مذكرة المقارنة" });
await as(U.lead, (tx, p) => addEvidenceRequest(tx, p, A.matrix.id, { title: "قرار المجلس باعتماد المصفوفة", dueDate: day(48) }));
await as(U.lead, (tx, p) => addActionNote(tx, p, A.matrix.id, { body: "ملاحظة داخلية: المدير المالي يميل لإبقاء حده كما هو؛ نناقشه في اجتماع اللجنة التوجيهية." }));

// The disclosures: two members could not be reached; the client accepts the risk and the firm closes it.
await start(A.disclosures.id, C.nOwner);
await send(A.disclosures.id, C.nOwner, F.nukhbaEvidence.disclosures, { submitForReview: false });
await as(C.nAdmin, (tx, p) =>
  signRiskAcceptance(tx, p, A.disclosures.id, { statement: "نقبل أن يُستكمل إفصاح العضوين المسافرين عند عودتهما، ونتحمل مخاطر التأخير حتى ذلك الحين." }),
);
await as(U.lead, (tx, p) =>
  transitionAction(tx, p, A.disclosures.id, { to: "closed", closure: { outcome: "risk_accepted", note: "خمسة إفصاحات من سبعة؛ الباقي بقبول مخاطر موقع من مدير الحساب." } }),
);

// How the client answered each recommendation (F10).
// Only the client admin and the project's sponsor answer for the client.
await as(C.nSponsor, (tx, p) =>
  recordResponse(tx, p, rec.charter.id, { stance: "agree", plannedAction: "عرض المسودة على المجلس في اجتماعه القادم", actionOwner: "أمانة المجلس", targetDate: day(20) }),
);
await as(C.nAdmin, (tx, p) =>
  recordResponse(tx, p, rec.doa.id, {
    stance: "partly_agree",
    reason: "نوافق على خفض حد الرئيس التنفيذي، لكن نرى إبقاء حد المدير المالي كما هو.",
    plannedAction: "رفع المقترح المعدل للجنة التوجيهية",
    actionOwner: "الإدارة المالية",
    targetDate: day(40),
  }),
);

// Meetings: the steering committee held last week, the next one booked, and Finance's own.
step("meetings, decisions and follow-ups");
const steering = await as(U.lead, (tx, p) =>
  bookMeeting(tx, p, board.id, {
    kind: "steering",
    title: "اجتماع اللجنة التوجيهية الثالث",
    startsAt: at(-7, 10),
    endsAt: at(-7, 11),
    location: "in_person",
    locationText: "مقر الشركة، الرياض — قاعة المجلس",
    spokenLang: "ar",
    attendees: [{ userId: C.nSponsor }, { userId: C.nManager }, { userId: C.nOwner2 }, { userId: U.consultant }],
  }),
);
await as(U.lead, (tx, p) => updateMeeting(tx, p, steering.id, { status: "held" }));
const decision = await as(U.lead, (tx, p) =>
  recordDecision(tx, p, steering.id, { text: "اعتماد خفض حد الرئيس التنفيذي إلى 750 ألف ريال، وإعادة دراسة حد المدير المالي.", lang: "ar" }),
);
await as(U.lead, (tx, p) =>
  saveSummary(tx, p, steering.id, {
    lang: "ar",
    mainPointsMd: "- اعتُمدت مسودة الميثاق للعرض على المجلس.\n- لجنة المراجعة متوقفة حتى موافقة الجمعية على المكافآت.\n- خفض حد الرئيس التنفيذي، وحد المدير المالي يعاد دراسته.",
  }),
);
await as(U.lead, (tx, p) => addFollowUp(tx, p, steering.id, { title: "إرسال جدول مقارنة الحدود المالية للجنة", assigneeUserId: C.nOwner2, dueAt: at(-2, 17), decisionId: decision.id }));
await as(U.lead, (tx, p) => addFollowUp(tx, p, steering.id, { title: "تجهيز مذكرة الجمعية العامة عن مكافآت الأعضاء المستقلين", assigneeUserId: C.nAdmin, dueAt: at(5, 17) }));
const fu3 = await as(U.lead, (tx, p) => addFollowUp(tx, p, steering.id, { title: "مشاركة قالب لائحة اللجنة مع الشؤون القانونية", assigneeUserId: U.consultant, dueAt: at(-5, 17) }));
await as(U.consultant, (tx, p) => updateFollowUp(tx, p, fu3.id, { status: "done" }));
const next = await as(U.lead, (tx, p) =>
  bookMeeting(tx, p, board.id, {
    kind: "steering",
    title: "اجتماع اللجنة التوجيهية الرابع",
    startsAt: at(6, 10),
    endsAt: at(6, 11),
    location: "online",
    joinUrl: "https://meet.google.com/abc-defg-hij",
    spokenLang: "ar",
    attendees: [{ userId: C.nSponsor }, { userId: C.nManager }, { userId: C.nAdmin }, { userId: U.consultant }, { userId: U.deputy, optional: true }],
  }),
);
await as(U.lead, (tx, p) => sendInvites(tx, p, next.id));
await as(U.lead, (tx, p) =>
  bookMeeting(tx, p, board.id, {
    kind: "workshop",
    title: "جلسة عمل الإدارة المالية: مصفوفة الصلاحيات",
    startsAt: at(2, 13),
    endsAt: at(2, 14),
    location: "online",
    joinUrl: "https://meet.google.com/xyz-abcd-efg",
    spokenLang: "ar",
    departmentId: dept.finance.id,
    attendees: [{ userId: C.nOwner2 }, { userId: U.deputy }],
  }),
);

// The kickoff request list: what the firm needs from the client.
step("requests for documents");
await as(U.lead, (tx, p) => addTemplateItems(tx, p, board.id, { keys: ["legal.articles", "governance.doa", "governance.org_chart"], ownerUserId: C.nAdmin, dueDate: day(7) }));
const minutesReq = await as(U.lead, (tx, p) =>
  createInfoRequest(tx, p, board.id, { area: "governance", title: "محاضر الجمعية العامة الأخيرة", description: "آخر جمعيتين عاديتين وأي جمعية غير عادية", sensitivity: "confidential", ownerUserId: C.nManager, dueDate: day(-3) }),
);
await as(C.nManager, async (tx, p) => {
  const file = await upload(C.nManager, { type: "info_request", id: minutesReq.id }, F.text("محاضر الجمعية العامة 2025.txt", "محضر الجمعية العامة العادية لعام 2025: اعتماد القوائم المالية وانتخاب المجلس."));
  return answerWithUpload(tx, p, minutesReq.id, file);
});

// Baseline assessment (firm only; the client sees it once shared).
step("assessment, indicators, report");
const starter = await as(U.admin, (tx, p) => installStarterTemplate(tx, p, { publish: true }));
const baseline = await as(U.lead, (tx, p) => createAssessment(tx, p, board.id, { templateId: starter.id, title: "التقييم المبدئي ٢٠٢٦" }));
{
  const sample: Record<string, string> = { "0.1": "family", "1.1": "yes", "1.2": "partly", "1.3": "no", "2.1": "no", "2.2": "informal", "4.1": "partly", "4.3": "2" };
  const seeded = await as(U.lead, (tx, p) => getAssessment(tx, p, baseline.id));
  for (const q of seeded.sections.flatMap((x) => x.questions)) {
    const value = q.ref ? sample[q.ref] : undefined;
    if (value) await as(U.lead, (tx, p) => answerQuestion(tx, p, q.answer.id, { value }));
  }
}

// Business indicators the client reports (KPI layer B), linked to the work.
const onTime = await as(U.lead, (tx, p) =>
  createIndicator(tx, p, nukhba.id, {
    nameAr: "قرارات المجلس المنفذة في موعدها",
    nameEn: "Board decisions carried out on time",
    definition: "نسبة قرارات المجلس التي نُفذت قبل الموعد المحدد في المحضر",
    unit: "%",
    direction: "higher_better",
    frequency: "monthly",
    baseline: 42,
    baselinePeriod: monthStart(6),
    target: 80,
    targetDate: day(240),
    source: "سجل متابعة قرارات أمانة المجلس",
    departmentId: dept.secretariat.id,
  }),
);
const approvals = await as(C.nAdmin, (tx, p) =>
  createIndicator(tx, p, nukhba.id, {
    nameAr: "متوسط أيام اعتماد المشتريات",
    nameEn: "Average days to approve a purchase",
    definition: "من طلب الشراء إلى اعتماده النهائي",
    unit: "يوم",
    direction: "lower_better",
    frequency: "monthly",
    baseline: 18,
    baselinePeriod: monthStart(6),
    target: 7,
    targetDate: day(180),
    source: "نظام المشتريات",
    departmentId: dept.finance.id,
  }),
);
for (const [back, a, b] of [
  [5, 45, 17],
  [4, 51, 16],
  [3, 55, 15],
  [2, 61, 12],
  [1, 66, 11],
] as const) {
  await as(C.nManager, (tx, p) => addValue(tx, p, onTime.id, { period: monthStart(back), value: a, note: null }));
  await as(C.nAdmin, (tx, p) => addValue(tx, p, approvals.id, { period: monthStart(back), value: b, note: back === 2 ? "بعد تطبيق الحدود الجديدة تجريبياً" : null }));
}
await as(U.lead, (tx, p) => linkRecommendation(tx, p, onTime.id, rec.charter.id));
await as(U.lead, (tx, p) => linkRecommendation(tx, p, approvals.id, rec.doa.id));

// A progress report the firm froze and shared with the client.
const report = await as(U.lead, (tx, p) =>
  snapshotReport(tx, p, board.id, {
    title: "تقرير المتابعة الشهري",
    periodStart: day(-30),
    periodEnd: day(0),
    bodyMd: "تقدم جيد في ميثاق المجلس. لجنة المراجعة متوقفة على قرار الجمعية العامة. مصفوفة الصلاحيات متأخرة أسبوعين.",
  }),
);
await as(U.lead, (tx, p) => shareReport(tx, p, report.id));

// The client assistant: the firm offers it, the client admin consents.
step("client assistant on for Al-Nukhba");
await as(U.admin, (tx, p) => setClientAi(tx, p, nukhba.id, { enabled: true, roles: ["client_admin", "client_manager"], dailyLimit: 30 }));
await as(C.nAdmin, (tx, p) => consentClientAi(tx, p, { version: CLIENT_AI_VERSION, locale: "ar" }));

// A problem the action owner reported from the help page.
await as(C.nOwner, (tx, p) => reportProblem(tx, p, { body: "لا أستطيع رفع ملف أكبر من 20 ميجابايت، والمحضر الممسوح ضوئياً حجمه 35 ميجابايت." }));

// ---------------------------------------------------------------- case 2: Rawdah, closing

step("case 2: Rawdah, strategic plan (closing)");
const plan = await as(U.lead2, (tx, p) =>
  createClientProject(tx, p, rawdah.id, { title: "Strategic Plan 2027 / الخطة الاستراتيجية ٢٠٢٧", description: "Build the 2027 plan, its KPIs and its roadmap.", startDate: day(-120), endDate: day(-5) }),
);
await as(U.admin, (tx, p) =>
  recordEngagement(tx, p, rawdah.id, {
    title: "Strategic planning engagement 2026",
    signedOn: day(-125),
    contractRef: "MZ-2026-007",
    scope: "Facilitate the 2027 strategic plan with the board of trustees and set up its follow-up.",
    startsOn: day(-120),
    endsOn: day(-5),
    projectIds: [plan.id],
  }),
);
for (const c of [C.rManager, C.rOwner]) await as(U.lead2, (tx, p) => addProjectPerson(tx, p, plan.id, c));
await as(U.lead2, (tx, p) => addClientRole(tx, p, plan.id, { role: "sponsor", person: `user:${C.rAdmin}` }));
{
  const file = await upload(U.lead2, { type: "project", id: plan.id }, F.rawdahLibrary.plan);
  await as(U.lead2, (tx, p) => uploadProjectDocument(tx, p, plan.id, { file, visibility: "shared" }));
}
const rPlan = await as(U.lead2, (tx, p) =>
  createRecommendation(tx, p, plan.id, {
    title: "Adopt the 2027 strategic plan with measurable KPIs",
    priority: "high",
    dueDate: day(-10),
    requiredEvidence: "The approved plan and its KPI cards",
    source: "consultant",
    visibility: "shared",
  }),
);
const rRoad = await as(U.lead2, (tx, p) =>
  createRecommendation(tx, p, plan.id, { title: "Set up a quarterly implementation review", priority: "medium", dueDate: day(-5), source: "consultant", visibility: "shared" }),
);
const RA = {
  kpis: await as(U.lead2, (tx, p) => createAction(tx, p, rPlan.id, { title: "Write KPI cards for each goal", ownerUserId: C.rManager, dueDate: day(-30), release: true })),
  approval: await as(U.lead2, (tx, p) => createAction(tx, p, rPlan.id, { title: "Board of trustees approves the plan", ownerUserId: C.rManager, dueDate: day(-15), release: true })),
  roadmap: await as(U.lead2, (tx, p) => createAction(tx, p, rRoad.id, { title: "Publish the 2027 implementation roadmap", ownerUserId: C.rOwner, dueDate: day(-8), release: true })),
  review: await as(U.lead2, (tx, p) => createAction(tx, p, rRoad.id, { title: "Hold the first quarterly review", ownerUserId: C.rOwner, dueDate: day(60), release: true })),
};
for (const [a, who, f] of [
  [RA.kpis.id, C.rManager, F.rawdahEvidence.kpis],
  [RA.approval.id, C.rManager, F.rawdahEvidence.approval],
  [RA.roadmap.id, C.rOwner, F.rawdahEvidence.roadmap],
] as const) {
  await start(a, who);
  await send(a, who, f);
  await as(U.lead2, (tx, p) => transitionAction(tx, p, a, { to: "verified_complete" }));
}
await start(RA.review.id, C.rOwner);
// The sponsor asks to close; the lead starts the closing gate, hands the one
// open action to Rawdah with a named person to keep it going, and writes the
// lessons. Closing itself is left for the firm admin to do in the walkthrough.
await as(C.rAdmin, (tx, p) => requestClosure(tx, p, plan.id, { note: "We have what we need; please close the project so we can run the reviews ourselves." }));
await as(U.lead2, (tx, p) => moveClosure(tx, p, plan.id, { step: "start" }));
await as(U.lead2, (tx, p) =>
  disposeAction(tx, p, plan.id, RA.review.id, { disposition: "handed_over", note: "Rawdah's planning office runs the quarterly reviews from now on.", sustainerUserId: C.rOwner }),
);
await as(U.lead2, (tx, p) =>
  writeLessons(tx, p, plan.id, {
    wentWell: "The trustees were engaged early; KPI cards were agreed in one workshop.",
    toImprove: "Evidence came in late at the end of each month.",
    nextTime: "Agree the evidence calendar at kickoff.",
  }),
);
await as(C.rAdmin, (tx, p) => recordCaseStudyConsent(tx, p, plan.id, { level: "anonymised", testimonial: false }));

// ---------------------------------------------------------------- case 3: Al-Waha, run by the firm

step("case 3: Al-Waha family charter (no client accounts)");
const family = await as(U.lead2, (tx, p) => createClientProject(tx, p, waha.id, { title: "ميثاق العائلة", startDate: day(-40), endDate: day(80) }));
await as(U.admin, (tx, p) =>
  recordEngagement(tx, p, waha.id, { title: "ميثاق العائلة والحوكمة", signedOn: day(-45), scope: "صياغة ميثاق العائلة وتشكيل مجلس العائلة.", projectIds: [family.id] }),
);
const wRec = await as(U.lead2, (tx, p) =>
  createRecommendation(tx, p, family.id, { title: "اعتماد ميثاق العائلة", priority: "high", dueDate: day(60), source: "consultant", visibility: "shared" }),
);
const wDraft = await as(U.lead2, (tx, p) =>
  createAction(tx, p, wRec.id, { title: "صياغة مسودة ميثاق العائلة", ownerName: "ماجد الواحي (مدير المكتب)", dueDate: day(10), release: true }),
);
await as(U.lead2, (tx, p) => createAction(tx, p, wRec.id, { title: "تشكيل مجلس العائلة", ownerName: "ماجد الواحي (مدير المكتب)", dueDate: day(45), release: true }));
await start(wDraft.id, U.lead2);
{
  const file = await upload(U.lead2, { type: "action", id: wDraft.id }, F.wahaEvidence.charter);
  await as(U.lead2, (tx, p) =>
    submitEvidence(tx, p, wDraft.id, { file, submitForReview: false, received: { receivedVia: "email", receivedOn: day(-3) } }),
  );
}

// The group: Al-Nukhba Holding and its real estate arm, rolled up together.
step("client group, internal project, inquiries and a pitch");
const reProj = await as(U.deputy, (tx, p) => createClientProject(tx, p, nukhbaRe.id, { title: "دليل الصلاحيات للتطوير العقاري", startDate: day(-20), endDate: day(70) }));
await as(U.admin, (tx, p) =>
  recordEngagement(tx, p, nukhbaRe.id, { title: "دليل الصلاحيات", signedOn: day(-25), scope: "مصفوفة صلاحيات للشركة التابعة.", projectIds: [reProj.id] }),
);
const reRec = await as(U.deputy, (tx, p) =>
  createRecommendation(tx, p, reProj.id, { title: "مواءمة صلاحيات التابعة مع الشركة الأم", priority: "medium", dueDate: day(50), source: "consultant", visibility: "shared" }),
);
await as(U.deputy, (tx, p) => createAction(tx, p, reRec.id, { title: "حصر الصلاحيات الحالية", ownerName: "م. تركي البقمي (المدير العام)", dueDate: day(15), release: true }));
const group = await as(U.admin, (tx, p) => createGroup(tx, p, { nameAr: "مجموعة النخبة", nameEn: "Al-Nukhba Group", notes: "الشركة القابضة وشركتها التابعة للتطوير العقاري." }));
await as(U.admin, (tx, p) => addMember(tx, p, group.id, nukhba.id));
await as(U.admin, (tx, p) => addMember(tx, p, group.id, nukhbaRe.id));
await as(U.admin, (tx, p) => setHolding(tx, p, group.id, nukhba.id));
// The holding's admin sees the whole group's progress.
await as(U.admin, (tx, p) => grantViewer(tx, p, group.id, C.nAdmin));

// The firm's own project: no client ever sees it.
const internal = await as(U.admin, (tx, p) => createInternalProject(tx, p, { title: "تحديث منهجية التقييم الداخلية", description: "مشروع داخلي للشركة، لا يراه العملاء" }));
await as(U.admin, (tx, p) => staffProject(tx, p, internal.id, U.lead));
await as(U.admin, (tx, p) => staffProject(tx, p, internal.id, U.consultant));
const iRec = await as(U.admin, (tx, p) => createRecommendation(tx, p, internal.id, { title: "توحيد قوالب التقارير", priority: "medium", source: "consultant", visibility: "firm_private" }));
await as(U.admin, (tx, p) => createAction(tx, p, iRec.id, { title: "إعداد قالب تقرير المتابعة", ownerUserId: U.consultant, dueDate: day(14), release: true }));

// Two inquiries from the public form, one already rated.
const no = { hasStrategy: false, hasOrgChart: true, hasDelegationMatrix: false, hasPolicies: false, hasSops: false, hasKpis: false };
const inquiryBase = { consent: true as const, marketingConsent: false, privacyNoticeVersion: PRIVACY_NOTICE_VERSION, selfCheck: no };
await as(U.admin, (tx) =>
  submitInquiry(
    tx,
    {
      ...inquiryBase,
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
      email: "salman@alfajr.test",
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
  ),
);
await as(U.admin, (tx) =>
  submitInquiry(
    tx,
    {
      ...inquiryBase,
      orgName: "Bayan Training Institute",
      sector: "training",
      employeeBand: "10-49",
      ownershipType: "llc",
      contactName: "Mona Al-Harbi",
      requesterRole: "executive",
      email: "mona@bayan.test",
      contactChannel: "email",
      preferredLanguage: "en",
      services: ["strategic_plan"],
      whyNow: "Our three-year plan ends in June and the board wants the next one ready.",
      urgency: "exploring",
    },
    null,
    null,
  ),
);

// A pitch Noura is preparing for a prospect: a draft client only the firm sees.
await as(U.deputy, (tx, p) => startPitch(tx, p, { name: "Madar Technology", nameAr: "شركة مدار للتقنية", projectTitle: "مقترح: حوكمة الشركة قبل الطرح" }));

// Who may let the assistant read a file is whoever owns it (the switch on
// each file's card): the lead for the firm's files, including Khalid's
// firm-only notes, which only the firm's assistant can ever quote; the
// client admin for the files their people sent. Evidence never changes and
// has no switch, and the confidential minutes the client sent stay out (a database rule).
step("files the assistant may read");
{
  const files = await sql(
    `SELECT d.id, d.owner_org_id FROM documents d WHERE d.project_id = ANY($1) AND d.purpose NOT IN ('evidence', 'client_document')`,
    [[board.id, plan.id]],
  );
  const switcher: Record<string, string> = { [FIRM]: U.lead, [nukhba.id]: C.nAdmin, [rawdah.id]: C.rAdmin };
  for (const f of files.rows) {
    const by = f.owner_org_id === FIRM && (await sql(`SELECT 1 FROM documents WHERE id = $1 AND project_id = $2`, [f.id, plan.id])).rowCount ? U.lead2 : switcher[f.owner_org_id]!;
    await as(by, (tx, p) => setAssistantFlag(tx, p, f.id, true));
  }
}

// Everyone accepted the terms, privacy notice and AI notice on their first
// sign-in when the engagement began (so the home pages show the work, not
// the first-week welcome), except Rawdah's action owner, who shows that page.
// Written directly: the record is append-only and dated by the database.
step("first sign-in notices accepted (all but owner@rawdah.test)");
for (const userId of [...Object.values(U), ...Object.values(C)].filter((u) => u !== C.rOwner)) {
  for (const [doc, version] of Object.entries(LEGAL_VERSIONS)) {
    await sql(`INSERT INTO consent_records (user_id, doc, version, locale, accepted_at) VALUES ($1, $2, $3, 'ar', now() - interval '60 days')`, [userId, doc, version]);
  }
}

// ---------------------------------------------------------------- done

await Promise.all([owner.end(), app.end()]);
console.log("walkthrough data loaded");
