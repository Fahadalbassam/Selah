// Report note templates: a fixed outline for a report's free-text note, in
// Arabic and English. Headings and short prompts to fill in, plus lines
// filled from the report's own numbers (the ones the client may see).
// Facts and headings only: no rating words, no model, nothing about the
// firm's own work. The counts are only those of a pack's frozen, client-side
// numbers; where they are not known (the New report dialog, which freezes them
// only when saved) the number sections are left out. Kept in code on purpose (no table, no user-made
// templates). Used by the New report dialog and the status pack's Issue
// dialog through FormDialog's note chooser.

export const REPORT_TEMPLATES = ["monthly", "steering", "closing"] as const;
export type ReportTemplateId = (typeof REPORT_TEMPLATES)[number];
export type ReportLang = "ar" | "en";

/** The counts a template may use: the same numbers the client sees on the report. */
export interface TemplateCounts {
  total: number;
  verified: number;
  partially: number;
  riskAccepted: number;
  notApplicable: number;
  superseded: number;
  open: number;
  overdue: number;
  /** Actions whose date moved later at least once. */
  extended?: number;
  /** Decisions waiting on the client (a status pack's own list). */
  decisions?: number;
}

export interface TemplateFacts {
  /** YYYY-MM-DD. */
  start?: string | null;
  end?: string | null;
  /** A line never shows a number it does not have: with null, the number lines are left out. */
  counts?: TemplateCounts | null;
}

type NumberKey = "applies" | "verified" | "partially" | "riskAccepted" | "notApplicable" | "superseded" | "open" | "overdue" | "extended" | "decisions";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function day(iso: string | null | undefined, lang: ReportLang): string | null {
  if (!iso || !DAY.test(iso)) return null;
  return new Intl.DateTimeFormat(lang, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
}

const WORDS: Record<ReportLang, { period: (a: string, b: string) => string; asOf: (d: string) => string; blank: string; label: Record<NumberKey, string> }> = {
  en: {
    period: (a, b) => `${a} to ${b}`,
    asOf: (d) => `Numbers as of ${d}:`,
    blank: "…",
    label: {
      applies: "Actions that apply",
      verified: "Verified",
      partially: "Partly done",
      riskAccepted: "Risk accepted",
      notApplicable: "Not applicable",
      superseded: "Replaced",
      open: "Open",
      overdue: "Open and past their date",
      extended: "Actions whose date moved",
      decisions: "Decisions waiting for you",
    },
  },
  ar: {
    period: (a, b) => `من ${a} إلى ${b}`,
    asOf: (d) => `الأرقام حتى ${d}:`,
    blank: "…",
    label: {
      applies: "الإجراءات المنطبقة",
      verified: "تم التحقق منها",
      partially: "منفّذة جزئيًا",
      riskAccepted: "مخاطرة مقبولة",
      notApplicable: "غير منطبقة",
      superseded: "حلّ محلّها غيرها",
      open: "مفتوحة",
      overdue: "مفتوحة وتجاوزت موعدها",
      extended: "إجراءات تغيّر موعدها",
      decisions: "قرارات بانتظاركم",
    },
  },
};

const TITLES: Record<ReportTemplateId, Record<ReportLang, string>> = {
  monthly: { en: "Monthly progress", ar: "التقدّم الشهري" },
  steering: { en: "Steering summary", ar: "ملخص اللجنة التوجيهية" },
  closing: { en: "Closing summary", ar: "ملخص الإغلاق" },
};

/** A heading, and the numbers (if any) that go under it. A heading with no numbers gets a blank line to fill in. */
interface Section {
  heading: Record<ReportLang, string>;
  numbers?: NumberKey[];
}

const SECTIONS: Record<ReportTemplateId, Section[]> = {
  monthly: [
    { heading: { en: "What was done this period", ar: "ما أُنجز في هذه الفترة" } },
    { heading: { en: "Actions in numbers", ar: "الإجراءات بالأرقام" }, numbers: ["applies", "verified", "partially", "riskAccepted", "open", "overdue"] },
    { heading: { en: "What changed since the last report", ar: "ما تغيّر منذ التقرير السابق" } },
    { heading: { en: "What is planned for next month", ar: "ما هو مخطط للشهر القادم" } },
    { heading: { en: "What we need from you", ar: "ما نحتاجه منكم" } },
  ],
  steering: [
    { heading: { en: "Decisions for the steering group", ar: "قرارات مطلوبة من اللجنة التوجيهية" }, numbers: ["decisions"] },
    { heading: { en: "Actions in numbers", ar: "الإجراءات بالأرقام" }, numbers: ["applies", "verified", "partially", "open", "overdue"] },
    { heading: { en: "Dates that moved, and why", ar: "المواعيد التي تغيّرت وسبب ذلك" }, numbers: ["extended"] },
    { heading: { en: "Risks accepted, and by whom", ar: "المخاطر المقبولة ومن قبلها" }, numbers: ["riskAccepted"] },
    { heading: { en: "Next steps, with who holds each", ar: "الخطوات التالية ومن يتولى كل خطوة" } },
  ],
  closing: [
    { heading: { en: "What the engagement covered", ar: "ما شمله العمل" } },
    {
      heading: { en: "How the actions ended", ar: "كيف انتهت الإجراءات" },
      numbers: ["applies", "verified", "partially", "riskAccepted", "notApplicable", "superseded", "open"],
    },
    { heading: { en: "What was handed over", ar: "ما جرى تسليمه" } },
    { heading: { en: "What stays open, and who holds it", ar: "ما بقي مفتوحًا ومن يتولاه" } },
    { heading: { en: "Who to ask after the engagement", ar: "لمن توجّهون أسئلتكم بعد انتهاء العمل" } },
  ],
};

function numberLines(keys: NumberKey[], counts: TemplateCounts, lang: ReportLang): string[] {
  const value: Record<NumberKey, number | undefined> = {
    applies: counts.total - counts.notApplicable - counts.superseded,
    verified: counts.verified,
    partially: counts.partially,
    riskAccepted: counts.riskAccepted,
    notApplicable: counts.notApplicable,
    superseded: counts.superseded,
    open: counts.open,
    overdue: counts.overdue,
    extended: counts.extended,
    decisions: counts.decisions,
  };
  const fmt = new Intl.NumberFormat(lang);
  const lines: string[] = [];
  for (const k of keys) {
    const v = value[k];
    if (v !== undefined) lines.push(`- ${WORDS[lang].label[k]}: ${fmt.format(v)}`);
  }
  return lines;
}

/**
 * The outline for one template, in one language, with the period and the
 * counts filled in where they are known. A section made only of
 * numbers is left out when they are not known.
 */
export function reportTemplate(id: ReportTemplateId, lang: ReportLang, facts: TemplateFacts = {}): string {
  const w = WORDS[lang];
  const from = day(facts.start, lang);
  const to = day(facts.end, lang);
  const out: string[] = [from && to ? `${TITLES[id][lang]}, ${w.period(from, to)}` : TITLES[id][lang], ""];
  let n = 0;
  let said = false;
  for (const s of SECTIONS[id]) {
    const lines = s.numbers ? (facts.counts ? numberLines(s.numbers, facts.counts, lang) : []) : [`- ${w.blank}`];
    // A section made of numbers is left out when they are not known: the report shows its own numbers under the note.
    if (!lines.length) continue;
    out.push(`${++n}. ${s.heading[lang]}`);
    if (s.numbers && to && !said) {
      out.push(w.asOf(to));
      said = true;
    }
    out.push(...lines, "");
  }
  return `${out.join("\n").trimEnd()}\n`;
}

/**
 * Choosing a template when the note already has text: never replace it
 * silently. "fill" when the note is empty; "ask" when there is text (a
 * "Use as draft" note or the person's own words).
 */
export function templateFill(currentNote: string): "fill" | "ask" {
  return currentNote.trim() === "" ? "fill" : "ask";
}

/** The note after choosing a template: the outline, or the current note when replacing was declined. */
export function noteAfterChoosing(currentNote: string, outline: string, replace: boolean): string {
  return templateFill(currentNote) === "fill" || replace ? outline : currentNote;
}
