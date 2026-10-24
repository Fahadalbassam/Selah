import { z } from "zod";

// The project's information request list (wave 1, item 9). The areas,
// statuses and sensitivities are the database's enums
// (tests/info-requests.test.ts keeps them equal).

export const INFO_REQUEST_AREAS = ["legal", "governance", "strategy", "finance", "people", "family", "operations", "other"] as const;
export const INFO_REQUEST_STATUSES = ["requested", "received", "reviewed", "not_applicable"] as const;
export const INFO_REQUEST_SENSITIVITIES = ["standard", "confidential"] as const;
export type InfoRequestArea = (typeof INFO_REQUEST_AREAS)[number];

export interface InfoRequestTemplate {
  key: string;
  area: Exclude<InfoRequestArea, "other">;
  en: string;
  ar: string;
  /** Starts as confidential: its files stay out of the assistant. */
  confidential?: boolean;
}

/**
 * The starting list a consultant picks from at kickoff, by area. The title
 * shows in the reader's language while the item is unchanged; editing it
 * makes it the firm's own wording.
 */
export const INFO_REQUEST_TEMPLATES: readonly InfoRequestTemplate[] = [
  { key: "legal.cr", area: "legal", en: "Commercial registration certificate (current)", ar: "شهادة السجل التجاري السارية" },
  { key: "legal.articles", area: "legal", en: "Articles of association and their amendments", ar: "عقد التأسيس وتعديلاته" },
  { key: "legal.bylaws", area: "legal", en: "Company bylaws", ar: "النظام الأساسي للشركة" },
  { key: "legal.licences", area: "legal", en: "Licences and permits from regulators", ar: "التراخيص والتصاريح النظامية" },
  { key: "legal.contracts", area: "legal", en: "List of material contracts", ar: "قائمة العقود الجوهرية" },
  { key: "governance.board_charter", area: "governance", en: "Board charter and committee charters", ar: "لائحة مجلس الإدارة ولوائح اللجان" },
  { key: "governance.minutes", area: "governance", en: "Board minutes for the last two years", ar: "محاضر مجلس الإدارة لآخر سنتين", confidential: true },
  { key: "governance.doa", area: "governance", en: "Current delegation of authority", ar: "مصفوفة الصلاحيات الحالية" },
  { key: "governance.policies", area: "governance", en: "Policies and procedures manual", ar: "دليل السياسات والإجراءات" },
  { key: "governance.org_chart", area: "governance", en: "Organisation chart", ar: "الهيكل التنظيمي" },
  { key: "strategy.plan", area: "strategy", en: "Current strategy or business plan", ar: "الاستراتيجية أو خطة العمل الحالية" },
  { key: "strategy.kpis", area: "strategy", en: "Performance (KPI) reports for the last year", ar: "تقارير مؤشرات الأداء للسنة الماضية" },
  { key: "strategy.market", area: "strategy", en: "Market and competitor studies", ar: "دراسات السوق والمنافسين" },
  { key: "strategy.initiatives", area: "strategy", en: "List of current initiatives and projects", ar: "قائمة المبادرات والمشاريع الحالية" },
  { key: "finance.statements", area: "finance", en: "Audited financial statements for the last three years", ar: "القوائم المالية المدققة لآخر ثلاث سنوات", confidential: true },
  { key: "finance.budget", area: "finance", en: "This year's budget", ar: "موازنة السنة الحالية", confidential: true },
  { key: "finance.management_accounts", area: "finance", en: "Latest management accounts", ar: "أحدث التقارير المالية الإدارية", confidential: true },
  { key: "finance.zakat", area: "finance", en: "Zakat and tax certificates", ar: "شهادات الزكاة والضريبة" },
  { key: "finance.debt", area: "finance", en: "Loans and guarantees", ar: "القروض والضمانات", confidential: true },
  { key: "people.headcount", area: "people", en: "Headcount by department", ar: "عدد الموظفين حسب الإدارة" },
  { key: "people.job_descriptions", area: "people", en: "Job descriptions", ar: "الأوصاف الوظيفية" },
  { key: "people.hr_policies", area: "people", en: "HR policies and grade structure", ar: "سياسات الموارد البشرية وسلّم الدرجات", confidential: true },
  { key: "people.saudization", area: "people", en: "Saudization (Nitaqat) status", ar: "حالة التوطين (نطاقات)" },
  { key: "family.tree", area: "family", en: "Family tree of the owners", ar: "شجرة العائلة للملّاك", confidential: true },
  { key: "family.ownership", area: "family", en: "Ownership structure and shareholdings", ar: "هيكل الملكية والحصص", confidential: true },
  { key: "family.agreements", area: "family", en: "Existing family agreements or charter", ar: "الاتفاقات العائلية أو الميثاق القائم", confidential: true },
  { key: "family.employment", area: "family", en: "Family members working in the business and their roles", ar: "أفراد العائلة العاملون في المنشأة وأدوارهم" },
  { key: "operations.processes", area: "operations", en: "Process maps for the core operations", ar: "خرائط الإجراءات للعمليات الرئيسة" },
  { key: "operations.systems", area: "operations", en: "List of IT systems in use", ar: "قائمة الأنظمة التقنية المستخدمة" },
  { key: "operations.suppliers", area: "operations", en: "Key suppliers and their contracts", ar: "الموردون الرئيسيون وعقودهم" },
];

export const templateByKey = (key: string | null | undefined) => (key ? INFO_REQUEST_TEMPLATES.find((t) => t.key === key) : undefined);

/** The item's title in the reader's language: a template's own wording, or the firm's. */
export const requestTitle = (r: { templateKey: string | null; title: string }, ar: boolean) => {
  const t = templateByKey(r.templateKey);
  return t ? (ar ? t.ar : t.en) : r.title;
};

const optionalText = (max: number) =>
  z.preprocess((v) => (typeof v === "string" ? v.trim() || null : v), z.string().max(max).nullable()).optional();
// "none" is the owner picker's "no one" choice (a select cannot hold an empty value).
export const NO_OWNER = "none";
const optionalId = z.preprocess((v) => (v === "" || v === NO_OWNER ? null : v), z.uuid().nullable()).optional();
const optionalDate = z.preprocess((v) => (v === "" ? null : v), z.iso.date().nullable()).optional();

const fields = {
  area: z.enum(INFO_REQUEST_AREAS),
  title: z.string().trim().min(2).max(200),
  description: optionalText(2000),
  sensitivity: z.enum(INFO_REQUEST_SENSITIVITIES),
  ownerUserId: optionalId,
  dueDate: optionalDate,
};

export const infoRequestInput = z.object({ ...fields, sensitivity: fields.sensitivity.default("standard") }).strict();
export type InfoRequestInput = z.infer<typeof infoRequestInput>;

// Without the default, so an edit that leaves sensitivity out keeps it.
export const infoRequestEdit = z.object(fields).partial().strict();

/** Add several template items at once, with one owner and due date. */
export const templateItemsInput = z
  .object({
    keys: z.array(z.string().refine((k) => !!templateByKey(k), "unknown template item")).min(1).max(INFO_REQUEST_TEMPLATES.length),
    ownerUserId: optionalId,
    dueDate: optionalDate,
  })
  .strict();

export const infoRequestMove = z
  .object({
    status: z.enum(["reviewed", "requested", "not_applicable"]),
    note: optionalText(1000),
  })
  .strict();
