import type { DocBlock } from "./office/docx-read";

/**
 * Importing a project plan (findings, recommendations, actions) from a
 * spreadsheet or a Word document. Pure, so the review screen and the server
 * run the very same checks: the screen to show each row's problems as the
 * consultant fixes them, the server again on confirm, where nothing the
 * browser sends is trusted. Nothing here writes; services/plan-import.ts
 * creates the records once a person confirms.
 */

export const IMPORT_FIELDS = [
  "finding",
  "findingDetails",
  "recommendation",
  "rationale",
  "targetOutcome",
  "priority",
  "recDueDate",
  "requiredEvidence",
  "action",
  "actionDetails",
  "owner",
  "department",
  "dueDate",
  "evidence",
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];
export type FieldValues = Partial<Record<ImportField, string>>;

/** One place in an uploaded file a plan can be read from: a worksheet, a Word table, or a Word outline. */
export type ImportSource =
  | { id: string; kind: "sheet"; name: string; rows: string[][]; truncated: boolean }
  | { id: string; kind: "table"; n: number; rows: string[][] }
  | { id: string; kind: "outline"; blocks: DocBlock[] };

/** The most rows one import may create. */
export const MAX_IMPORT_ROWS = 500;

export const IMPORT_LIMITS = {
  title: 300,
  details: 8000,
  targetOutcome: 4000,
  requiredEvidence: 4000,
  owner: 200,
  department: 200,
  evidenceItem: 300,
  evidenceItems: 50,
} as const;

// ------------------------------------------------------------ text

const DIGITS: Record<string, string> = {};
for (let i = 0; i < 10; i++) {
  DIGITS[String.fromCharCode(0x0660 + i)] = String(i);
  DIGITS[String.fromCharCode(0x06f0 + i)] = String(i);
}

/** Arabic-Indic and Persian digits as ASCII digits. */
export function asciiDigits(s: string): string {
  return s.replace(/[٠-٩۰-۹]/g, (d) => DIGITS[d]!);
}

/**
 * A form of a name or heading for matching: no diacritics or tatweel, one
 * alef, ya and ta marbuta folded, lower case, punctuation as spaces. Two
 * spellings people would call "the same" compare equal.
 */
export function normText(s: string): string {
  return asciiDigits(s.normalize("NFKC"))
    .replace(/[ً-ٰٟـ]/g, "")
    .replace(/[​-‏‪-‮⁦-⁩؜]/g, "")
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}@.]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ------------------------------------------------------------ headers

const SYNONYMS: Record<ImportField, string[]> = {
  finding: ["finding", "findings", "observation", "observations", "gap", "issue", "الملاحظة", "الملاحظات", "ملاحظة", "الفجوة", "فجوة", "المشكلة"],
  findingDetails: ["finding details", "finding description", "observation details", "تفاصيل الملاحظة", "وصف الملاحظة", "شرح الملاحظة"],
  recommendation: ["recommendation", "recommendations", "recommendation title", "التوصية", "التوصيات", "توصية", "نص التوصية"],
  rationale: ["rationale", "reason", "justification", "why", "السبب", "المبرر", "المبررات", "سبب التوصية", "مبرر التوصية"],
  targetOutcome: ["target outcome", "expected outcome", "outcome", "النتيجة المستهدفة", "النتيجة المتوقعة", "الأثر المتوقع"],
  priority: ["priority", "الأولوية", "الاولوية", "درجة الأولوية", "الأهمية", "درجة الأهمية"],
  recDueDate: ["recommendation due date", "recommendation deadline", "تاريخ استحقاق التوصية", "موعد التوصية"],
  requiredEvidence: ["required evidence", "evidence required", "proof of implementation", "الدليل المطلوب", "دليل التنفيذ", "الدليل الذي يثبت التنفيذ"],
  action: ["action", "actions", "action title", "task", "step", "implementation step", "الإجراء", "الإجراءات", "اجراء", "المهمة", "الخطوة", "الإجراء التنفيذي"],
  actionDetails: ["action details", "action description", "description", "details", "what is needed", "تفاصيل الإجراء", "وصف الإجراء", "المطلوب", "التفاصيل", "الوصف"],
  owner: ["owner", "action owner", "responsible", "person responsible", "assignee", "assigned to", "المسؤول", "المسؤول عن التنفيذ", "المكلف", "صاحب الإجراء", "المسؤول عن الإجراء"],
  department: ["department", "unit", "division", "الإدارة", "الادارة", "القسم", "الوحدة"],
  dueDate: ["due date", "deadline", "due", "target date", "completion date", "تاريخ الاستحقاق", "الموعد النهائي", "تاريخ الإنجاز", "موعد التنفيذ", "التاريخ المستهدف", "تاريخ التنفيذ"],
  evidence: ["evidence list", "evidence", "evidence items", "documents required", "قائمة الأدلة", "الأدلة", "أدلة التنفيذ", "المستندات المطلوبة"],
};

/** Headers Selah writes in its own export that an import reads past (status is never imported). */
const KNOWN_OTHER = ["status", "visibility", "who sees it", "no", "#", "الحالة", "من يراها", "م", "رقم", "الرقم"];

const NORMALISED = Object.fromEntries(IMPORT_FIELDS.map((f) => [f, SYNONYMS[f].map(normText)])) as Record<ImportField, string[]>;
const OTHER = new Set(KNOWN_OTHER.map(normText));

function headerMatch(header: string): { field: ImportField; exact: boolean; length: number } | null {
  const h = normText(header);
  if (!h) return null;
  for (const f of IMPORT_FIELDS) if (NORMALISED[f].includes(h)) return { field: f, exact: true, length: h.length };
  let best: { field: ImportField; exact: boolean; length: number } | null = null;
  for (const f of IMPORT_FIELDS) {
    for (const syn of NORMALISED[f]) {
      if (syn.length >= 4 && h.includes(syn) && (!best || syn.length > best.length)) best = { field: f, exact: false, length: syn.length };
    }
  }
  return best;
}

/** Which source column feeds each field, by header name in Arabic or English. Each field takes one column at most. */
export function suggestMapping(headers: string[]): (ImportField | null)[] {
  const matches = headers.map(headerMatch);
  const out: (ImportField | null)[] = headers.map(() => null);
  const taken = new Set<ImportField>();
  // Exact names first, then the longest partial matches.
  const order = matches
    .map((m, i) => ({ m, i }))
    .filter((x) => x.m)
    .sort((a, b) => Number(b.m!.exact) - Number(a.m!.exact) || b.m!.length - a.m!.length || a.i - b.i);
  for (const { m, i } of order) {
    if (taken.has(m!.field)) continue;
    taken.add(m!.field);
    out[i] = m!.field;
  }
  return out;
}

/** The row (0-based) that holds the column headings: the first of the top rows that names the most fields. */
export function findHeaderRow(rows: string[][]): number {
  let best = -1;
  let score = 1;
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const s = (rows[i] ?? []).filter((c) => headerMatch(c) || OTHER.has(normText(c))).length;
    if (s > score) {
      best = i;
      score = s;
    }
  }
  if (best >= 0) return best;
  const first = rows.findIndex((r) => r.some((c) => c.trim()));
  return first < 0 ? 0 : first;
}

// ------------------------------------------------------------ rows

export interface ImportRow {
  /** The row's number in the source (1-based), for messages. */
  line: number;
  include: boolean;
  values: FieldValues;
  /** Fields copied from the row above (merged or blank cells). */
  filled: ImportField[];
}

/** Turn a table into rows under the chosen mapping. Blank rows are skipped; merged or blank finding and recommendation cells take the value above. */
export function applyMapping(rows: string[][], headerRow: number, mapping: (ImportField | null)[]): ImportRow[] {
  const out: ImportRow[] = [];
  let prev: FieldValues = {};
  for (let r = headerRow + 1; r < rows.length; r++) {
    const values: FieldValues = {};
    mapping.forEach((field, c) => {
      if (!field) return;
      const v = (rows[r]?.[c] ?? "").replace(/\r\n?/g, "\n").trim();
      if (v) values[field] = values[field] ? `${values[field]}\n${v}` : v;
    });
    if (!Object.keys(values).length) continue;
    out.push(fillDown(r + 1, values, prev));
    prev = out[out.length - 1]!.values;
  }
  return out;
}

function fillDown(line: number, values: FieldValues, prev: FieldValues): ImportRow {
  const filled: ImportField[] = [];
  const v = { ...values };
  if (!v.recommendation && v.action && prev.recommendation) {
    v.recommendation = prev.recommendation;
    filled.push("recommendation");
  }
  if (!v.finding && (v.recommendation || v.action) && prev.finding && (filled.includes("recommendation") || !v.findingDetails)) {
    v.finding = prev.finding;
    filled.push("finding");
  }
  return { line, include: true, values: v, filled };
}

/** Leading numbering on a heading ("1.2 ", "٣) ", "أ- ") that is not part of the title. */
function stripNumbering(text: string): string {
  return text.replace(/^\s*(?:[\d٠-٩]+(?:[.\-)][\d٠-٩]+)*[.\-):]?|[a-zA-Zء-ي][.)\-])\s+/, "").trim() || text.trim();
}

export type OutlineMode = "findings" | "recommendations";

/** Which reading of a Word outline fits: two heading levels or more read as findings over recommendations. */
export function outlineMode(blocks: DocBlock[]): OutlineMode {
  const levels = new Set(blocks.filter((b) => b.type === "heading").map((b) => (b as { level: number }).level));
  return levels.size >= 2 ? "findings" : "recommendations";
}

/**
 * A Word outline as rows. With mode "findings", the top heading level is a
 * finding and any deeper heading a recommendation; with "recommendations",
 * every heading is a recommendation. List items under a recommendation are
 * its actions. Paragraphs describe whatever came last: a finding, a
 * recommendation (its rationale) or an action.
 */
export function outlineRows(blocks: DocBlock[], mode: OutlineMode): ImportRow[] {
  const headings = blocks.filter((b) => b.type === "heading") as { level: number; text: string }[];
  if (!headings.length) return [];
  const top = Math.min(...headings.map((h) => h.level));
  const rows: ImportRow[] = [];
  let finding: FieldValues | null = null;
  let rec: FieldValues | null = null;
  let recRows: ImportRow[] = [];
  let lastAction: ImportRow | null = null;
  let n = 0;
  const flushRec = () => {
    if (rec && !recRows.length) rows.push({ line: ++n, include: true, values: { ...finding, ...rec }, filled: [] });
    rows.push(...recRows);
    recRows = [];
    rec = null;
    lastAction = null;
  };
  const flushFinding = () => {
    const hadRows = rows.length;
    flushRec();
    if (finding && rows.length === hadRows && !rows.some((r) => r.values.finding === finding!.finding))
      rows.push({ line: ++n, include: true, values: { ...finding }, filled: [] });
    finding = null;
  };
  const append = (target: FieldValues, field: ImportField, text: string) => {
    target[field] = target[field] ? `${target[field]}\n${text}` : text;
  };
  for (const b of blocks) {
    if (b.type === "table") continue;
    if (b.type === "heading") {
      const title = stripNumbering(b.text);
      if (mode === "findings" && b.level === top) {
        flushFinding();
        finding = { finding: title };
      } else {
        flushRec();
        rec = { recommendation: title };
      }
      continue;
    }
    if (b.list && rec) {
      lastAction = { line: ++n, include: true, values: { ...finding, ...rec, action: stripNumbering(b.text) }, filled: [] };
      recRows.push(lastAction);
    } else if (lastAction) append(lastAction.values, "actionDetails", b.text);
    else if (rec) append(rec, "rationale", b.text);
    else if (finding) append(finding, "findingDetails", b.text);
  }
  flushFinding();
  // Rows carry their finding's and recommendation's details only once.
  const seenFinding = new Set<string>();
  const seenRec = new Set<string>();
  for (const r of rows) {
    const f = r.values.finding ?? "";
    const rec = `${f}\u0000${r.values.recommendation ?? ""}`;
    if (seenFinding.has(f)) delete r.values.findingDetails;
    if (seenRec.has(rec)) delete r.values.rationale;
    seenFinding.add(f);
    seenRec.add(rec);
  }
  return rows;
}

// ------------------------------------------------------------ values

const MONTHS: Record<string, number> = {};
[
  ["january", "jan", "يناير", "كانون الثاني"],
  ["february", "feb", "فبراير", "شباط"],
  ["march", "mar", "مارس", "آذار"],
  ["april", "apr", "أبريل", "ابريل", "نيسان"],
  ["may", "مايو", "أيار"],
  ["june", "jun", "يونيو", "حزيران"],
  ["july", "jul", "يوليو", "تموز"],
  ["august", "aug", "أغسطس", "اغسطس", "آب"],
  ["september", "sep", "sept", "سبتمبر", "أيلول"],
  ["october", "oct", "أكتوبر", "اكتوبر", "تشرين الأول"],
  ["november", "nov", "نوفمبر", "تشرين الثاني"],
  ["december", "dec", "ديسمبر", "كانون الأول"],
].forEach((names, i) => names.forEach((n) => (MONTHS[normText(n)] = i + 1)));

function validGregorian(y: number, m: number, d: number): string | null {
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCMonth() !== m - 1) return null;
  return date.toISOString().slice(0, 10);
}

let hijriFormat: Intl.DateTimeFormat | null = null;

/** An Umm al-Qura (Saudi official) Hijri date as a Gregorian date, or null if it does not exist. */
export function hijriToIso(y: number, m: number, d: number): string | null {
  if (y < 1300 || y > 1600 || m < 1 || m > 12 || d < 1 || d > 30) return null;
  hijriFormat ??= new Intl.DateTimeFormat("en-US-u-ca-islamic-umalqura", { timeZone: "UTC", year: "numeric", month: "numeric", day: "numeric" });
  // Start near the right day (the mean Hijri year is 354.367 days) and search around it.
  const guess = Date.UTC(622, 6, 16) + Math.floor((y - 1) * 354.367 + (m - 1) * 29.53 + (d - 1)) * 86_400_000;
  for (let offset = 0; offset <= 60; offset++) {
    for (const sign of offset ? [1, -1] : [1]) {
      const t = guess + sign * offset * 86_400_000;
      const parts = hijriFormat.formatToParts(new Date(t));
      const get = (type: string) => parseInt(parts.find((p) => p.type === type)?.value ?? "", 10);
      if (get("year") === y && get("month") === m && get("day") === d) return new Date(t).toISOString().slice(0, 10);
    }
  }
  return null;
}

/** A date as people type it: ISO, day/month/year, an Excel day number, month names, or Hijri (a year before 1600, or marked هـ). */
export function parseDate(raw: string | undefined): { iso: string; hijri: boolean } | { error: true } | null {
  if (!raw?.trim()) return null;
  let s = asciiDigits(raw).replace(/[‎‏؜]/g, "").trim();
  const markedHijri = /(هـ|ھ|\bAH)\.?\s*$/i.test(s);
  s = s.replace(/\s*(هـ|ھ|ه|م|AH|AD|CE)\.?\s*$/i, "").trim();
  s = s.replace(/T\d{2}:\d{2}.*$/, "").replace(/\s+\d{1,2}:\d{2}(:\d{2})?$/, "");
  let y: number | undefined, m: number | undefined, d: number | undefined;
  let match: RegExpExecArray | null;
  if ((match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s))) [y, m, d] = [+match[1]!, +match[2]!, +match[3]!];
  else if ((match = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/.exec(s))) {
    [d, m, y] = [+match[1]!, +match[2]!, +match[3]!];
    // Day first is the local habit; a month over 12 means the writer put the month first.
    if (m > 12 && d <= 12) [d, m] = [m, d];
    if (y < 100) y += markedHijri ? 1400 : 2000;
  } else if ((match = /^(\d{1,2})\s+([\p{L} ]+?)\s*,?\s+(\d{4})$/u.exec(s))) {
    [d, m, y] = [+match[1]!, MONTHS[normText(match[2]!)], +match[3]!];
  } else if ((match = /^([\p{L} ]+?)\s+(\d{1,2}),?\s+(\d{4})$/u.exec(s))) {
    [m, d, y] = [MONTHS[normText(match[1]!)], +match[2]!, +match[3]!];
  } else if (/^\d{5}(\.\d+)?$/.test(s)) {
    // An Excel day number that was not formatted as a date (1927 to 2119).
    const serial = Math.floor(Number(s));
    if (serial >= 10_000 && serial <= 80_000)
      return { iso: new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000).toISOString().slice(0, 10), hijri: false };
  }
  if (y === undefined || m === undefined || d === undefined) return { error: true };
  if (markedHijri || y < 1600) {
    const iso = hijriToIso(y, m, d);
    return iso ? { iso, hijri: true } : { error: true };
  }
  const iso = validGregorian(y, m, d);
  return iso ? { iso, hijri: false } : { error: true };
}

export type Priority = "low" | "medium" | "high" | "critical";
const PRIORITY: Record<string, Priority> = {};
(
  [
    ["low", ["low", "minor", "منخفضه", "منخفض", "متدنيه", "ضعيفه", "4", "p4"]],
    ["medium", ["medium", "moderate", "normal", "متوسطه", "متوسط", "عاديه", "3", "p3"]],
    ["high", ["high", "major", "important", "عاليه", "عالي", "مرتفعه", "مرتفع", "مهمه", "2", "p2"]],
    ["critical", ["critical", "urgent", "very high", "حرجه", "حرج", "عاجله", "عاجل", "قصوى", "عاليه جدا", "1", "p1"]],
  ] as const
).forEach(([p, words]) => words.forEach((w) => (PRIORITY[normText(w)] = p)));

/** A priority word in Arabic or English; null when it is not one. */
export function parsePriority(raw: string | undefined): Priority | null {
  if (!raw?.trim()) return "medium";
  return PRIORITY[normText(raw)] ?? null;
}

/** The evidence list: one item per line, or separated by semicolons; bullets and numbers dropped. */
export function splitEvidence(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(/\r?\n|[;؛•]/)
    .map((s) => s.replace(/^\s*(?:[-*–·]|[\d٠-٩]+[.)\-])\s*/, "").trim())
    .filter(Boolean);
}

// ------------------------------------------------------------ checking

export interface ImportContext {
  /** The firm's today (YYYY-MM-DD), for due dates in the past. */
  today: string;
  /** A client project (internal projects have no client to hide anything from). */
  client: boolean;
  /** The client is managed by the firm: an owner is a typed name, not an account. */
  ownerByName: boolean;
  /** ...and keeps minimal records: the typed owner is a job title. */
  minimalRecords: boolean;
  canRelease: boolean;
  owners: { userId: string; name: string; email: string }[];
  departments: { id: string; nameAr: string; nameEn: string | null }[];
  findings: { id: string; title: string }[];
  recommendations: { id: string; title: string; findingId: string | null }[];
  actions: { recommendationId: string; title: string }[];
}

export interface ImportOptions {
  visibility: "shared" | "firm_private";
  /** Release actions that have an owner and a due date; the rest stay drafts. */
  release: boolean;
}

export type IssueCode =
  | "noTitle"
  | "needsRecommendation"
  | "tooLong"
  | "badDate"
  | "pastDate"
  | "hijri"
  | "badPriority"
  | "ownerUnknown"
  | "ownerPartial"
  | "departmentUnknown"
  | "departmentsOff"
  | "tooManyItems"
  | "findingExists"
  | "recommendationExists"
  | "recommendationOtherFinding"
  | "recommendationDiffers"
  | "actionExists"
  | "actionRepeated"
  | "staysDraft"
  | "filled";

export interface Issue {
  code: IssueCode;
  field?: ImportField;
  /** A value for the message, e.g. the matched person's name or the converted date. */
  detail?: string;
}

export interface RowCheck {
  line: number;
  /** The row cannot be imported until fixed or left out. */
  errors: Issue[];
  /** It can be imported, but look first. */
  warnings: Issue[];
  /** Plain facts about what will happen. */
  notes: Issue[];
  /** What the row will create. */
  creates: { finding: boolean; recommendation: boolean; action: "draft" | "release" | null };
}

export interface PlannedFinding {
  key: string;
  existingId: string | null;
  title: string;
  description?: string;
}
export interface PlannedRecommendation {
  key: string;
  existingId: string | null;
  findingKey: string | null;
  title: string;
  rationale?: string;
  targetOutcome?: string;
  priority: Priority;
  dueDate?: string;
  requiredEvidence?: string;
}
export interface PlannedAction {
  line: number;
  recommendationKey: string;
  title: string;
  description?: string;
  ownerUserId?: string;
  ownerName?: string;
  departmentId?: string;
  dueDate?: string;
  evidence: string[];
  release: boolean;
}

export interface ImportCheck {
  rows: RowCheck[];
  plan: { findings: PlannedFinding[]; recommendations: PlannedRecommendation[]; actions: PlannedAction[] };
  counts: { findings: number; recommendations: number; actions: number; released: number; withErrors: number; withWarnings: number };
  /** More rows than one import takes. */
  tooMany: boolean;
}

const LENGTH: Partial<Record<ImportField, number>> = {
  finding: IMPORT_LIMITS.title,
  recommendation: IMPORT_LIMITS.title,
  action: IMPORT_LIMITS.title,
  findingDetails: IMPORT_LIMITS.details,
  rationale: IMPORT_LIMITS.details,
  actionDetails: IMPORT_LIMITS.details,
  targetOutcome: IMPORT_LIMITS.targetOutcome,
  requiredEvidence: IMPORT_LIMITS.requiredEvidence,
  owner: IMPORT_LIMITS.owner,
  department: IMPORT_LIMITS.department,
};

function matchOwner(raw: string, owners: ImportContext["owners"]): { userId: string; name: string; partial: boolean } | null {
  const n = normText(raw);
  const exact = owners.filter((o) => normText(o.name) === n || o.email.toLowerCase() === raw.trim().toLowerCase());
  if (exact.length === 1) return { ...exact[0]!, partial: false };
  if (exact.length > 1) return null;
  // Every word given appears in exactly one person's name ("Abdullah" for "Abdullah Al-Harbi").
  const words = n.split(" ").filter(Boolean);
  const partial = owners.filter((o) => {
    const name = normText(o.name).split(" ");
    return words.length > 0 && words.every((w) => name.includes(w));
  });
  return partial.length === 1 ? { ...partial[0]!, partial: true } : null;
}

/**
 * Check the rows and work out what they would create. Rows left out are
 * skipped; rows with errors create nothing. The server runs this again on
 * confirm with its own context and refuses if any included row has an error.
 */
export function checkImport(rows: ImportRow[], ctx: ImportContext, options: ImportOptions): ImportCheck {
  const checks: RowCheck[] = [];
  const findings = new Map<string, PlannedFinding>();
  const recs = new Map<string, PlannedRecommendation>();
  const actions: PlannedAction[] = [];
  const actionKeys = new Set<string>();
  const existingFinding = new Map(ctx.findings.map((f) => [normText(f.title), f]));
  const existingRec = new Map(ctx.recommendations.map((r) => [normText(r.title), r]));
  const existingAction = new Set(ctx.actions.map((a) => `${a.recommendationId}\u0000${normText(a.title)}`));
  const included = rows.filter((r) => r.include);

  for (const row of included) {
    const v = row.values;
    const check: RowCheck = { line: row.line, errors: [], warnings: [], notes: [], creates: { finding: false, recommendation: false, action: null } };
    checks.push(check);
    for (const f of row.filled) check.notes.push({ code: "filled", field: f });

    for (const [field, max] of Object.entries(LENGTH) as [ImportField, number][]) {
      if ((v[field]?.length ?? 0) > max) check.errors.push({ code: "tooLong", field, detail: String(max) });
    }
    if (!v.finding && !v.recommendation) check.errors.push({ code: v.action ? "needsRecommendation" : "noTitle" });
    else if (v.action && !v.recommendation) check.errors.push({ code: "needsRecommendation", field: "recommendation" });

    const recDue = parseDate(v.recDueDate);
    if (recDue && "error" in recDue) check.errors.push({ code: "badDate", field: "recDueDate" });
    else if (recDue?.hijri) check.notes.push({ code: "hijri", field: "recDueDate", detail: recDue.iso });
    const due = parseDate(v.dueDate);
    if (due && "error" in due) check.errors.push({ code: "badDate", field: "dueDate" });
    else if (due) {
      if (due.hijri) check.notes.push({ code: "hijri", field: "dueDate", detail: due.iso });
      if (v.action && due.iso < ctx.today) check.warnings.push({ code: "pastDate", field: "dueDate" });
    }
    const priority = parsePriority(v.priority);
    if (!priority) check.warnings.push({ code: "badPriority", field: "priority" });

    const evidence = v.action ? splitEvidence(v.evidence) : [];
    if (evidence.length > IMPORT_LIMITS.evidenceItems) check.errors.push({ code: "tooManyItems", field: "evidence", detail: String(IMPORT_LIMITS.evidenceItems) });
    if (evidence.some((e) => e.length > IMPORT_LIMITS.evidenceItem))
      check.errors.push({ code: "tooLong", field: "evidence", detail: String(IMPORT_LIMITS.evidenceItem) });

    // Who answers for the action.
    let ownerUserId: string | undefined;
    let ownerName: string | undefined;
    if (v.action && v.owner) {
      if (ctx.ownerByName) ownerName = v.owner;
      else {
        const m = matchOwner(v.owner, ctx.owners);
        if (!m) check.warnings.push({ code: "ownerUnknown", field: "owner", detail: v.owner });
        else {
          ownerUserId = m.userId;
          if (m.partial) check.warnings.push({ code: "ownerPartial", field: "owner", detail: m.name });
        }
      }
    }
    let departmentId: string | undefined;
    if (v.action && v.department) {
      if (!ctx.departments.length) check.warnings.push({ code: "departmentsOff", field: "department" });
      else {
        const n = normText(v.department);
        const d = ctx.departments.find((x) => normText(x.nameAr) === n || (x.nameEn && normText(x.nameEn) === n));
        if (d) departmentId = d.id;
        else check.warnings.push({ code: "departmentUnknown", field: "department", detail: v.department });
      }
    }

    if (check.errors.length) continue;

    // The finding: one already in the project, one earlier in the file, or a new one.
    let findingKey: string | null = null;
    if (v.finding) {
      findingKey = normText(v.finding);
      const existing = existingFinding.get(findingKey);
      if (!findings.has(findingKey)) {
        findings.set(findingKey, { key: findingKey, existingId: existing?.id ?? null, title: v.finding, description: v.findingDetails });
        if (existing) check.notes.push({ code: "findingExists", field: "finding" });
        else check.creates.finding = true;
      }
    }

    if (v.recommendation) {
      const key = normText(v.recommendation);
      const existing = existingRec.get(key);
      const planned = recs.get(key);
      if (!planned) {
        const rec: PlannedRecommendation = {
          key,
          existingId: existing?.id ?? null,
          findingKey,
          title: v.recommendation,
          rationale: v.rationale,
          targetOutcome: v.targetOutcome,
          priority: priority ?? "medium",
          dueDate: recDue && !("error" in recDue) ? recDue.iso : undefined,
          requiredEvidence: v.requiredEvidence,
        };
        recs.set(key, rec);
        if (existing) {
          check.notes.push({ code: "recommendationExists", field: "recommendation" });
          const existingFindingKey = ctx.findings.find((f) => f.id === existing.findingId)?.title;
          if (findingKey && normText(existingFindingKey ?? "") !== findingKey)
            check.warnings.push({ code: "recommendationOtherFinding", field: "finding" });
        } else check.creates.recommendation = true;
      } else {
        if (planned.findingKey !== findingKey && findingKey) check.warnings.push({ code: "recommendationOtherFinding", field: "finding" });
        // The recommendation's details come from its first row; say when a later row says something else.
        const differs = (["rationale", "targetOutcome", "requiredEvidence"] as const).filter((f) => v[f] && planned[f] && v[f] !== planned[f]);
        for (const f of differs) check.warnings.push({ code: "recommendationDiffers", field: f });
      }

      if (v.action) {
        const actionKey = `${existing?.id ?? key}\u0000${normText(v.action)}`;
        if (existing && existingAction.has(actionKey)) check.warnings.push({ code: "actionExists", field: "action" });
        else if (actionKeys.has(actionKey)) check.warnings.push({ code: "actionRepeated", field: "action" });
        actionKeys.add(actionKey);
        const dueIso = due && !("error" in due) ? due.iso : undefined;
        const release = options.release && ctx.canRelease && !!(ownerUserId || ownerName) && !!dueIso && dueIso >= ctx.today;
        if (options.release && !release) check.notes.push({ code: "staysDraft" });
        actions.push({
          line: row.line,
          recommendationKey: key,
          title: v.action,
          description: v.actionDetails,
          ownerUserId,
          ownerName,
          departmentId,
          dueDate: dueIso,
          evidence,
          release,
        });
        check.creates.action = release ? "release" : "draft";
      }
    }
  }

  const plan = { findings: [...findings.values()], recommendations: [...recs.values()], actions };
  return {
    rows: checks,
    plan,
    counts: {
      findings: plan.findings.filter((f) => !f.existingId).length,
      recommendations: plan.recommendations.filter((r) => !r.existingId).length,
      actions: actions.length,
      released: actions.filter((a) => a.release).length,
      withErrors: checks.filter((c) => c.errors.length).length,
      withWarnings: checks.filter((c) => c.warnings.length).length,
    },
    tooMany: included.length > MAX_IMPORT_ROWS,
  };
}

/** Rows that duplicate an action already in the project start left out, so a re-import adds nothing twice. */
export function leaveOutDuplicates(rows: ImportRow[], ctx: ImportContext, options: ImportOptions): ImportRow[] {
  const check = checkImport(rows, ctx, options);
  const dup = new Set(check.rows.filter((r) => r.warnings.some((w) => w.code === "actionExists")).map((r) => r.line));
  return rows.map((r) => (dup.has(r.line) ? { ...r, include: false } : r));
}
