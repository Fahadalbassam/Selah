// Shared by the assessment routes and services (baseline: Assessments).

export const LEGAL_FORMS = [
  "sole_proprietorship",
  "llc",
  "closed_jsc",
  "listed_jsc",
  "bank_or_finance_company",
  "capital_market_institution",
  "non_profit",
  "other",
] as const;
export type LegalForm = (typeof LEGAL_FORMS)[number];

export const QUESTION_TYPES = ["yes_no", "multiple_choice", "rating", "text"] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

/**
 * Where a criterion comes from, for one client. Never shown as "compliant"
 * or "non-compliant": a gap is a gap against good practice, the firm's
 * method, or (only when it binds this client) a legal requirement.
 */
export const BASES = ["legal_requirement", "regulator_guidance", "good_practice", "firm_method", "team_proposed"] as const;
export type Basis = (typeof BASES)[number];
/** A question's own basis. Legal requirement and regulator guidance come only from its legal forms, per client. */
export const OWN_BASES = ["good_practice", "firm_method", "team_proposed"] as const;
export type OwnBasis = (typeof OWN_BASES)[number];

export const BASIS_LABELS: Record<Basis, { en: string; ar: string }> = {
  legal_requirement: { en: "Legal requirement for this client", ar: "متطلب نظامي لهذا العميل" },
  regulator_guidance: { en: "Regulator guidance (not binding for this client)", ar: "إرشاد تنظيمي (غير ملزم لهذا العميل)" },
  good_practice: { en: "Good practice (voluntary)", ar: "ممارسة جيدة (اختيارية)" },
  firm_method: { en: "The firm's method", ar: "منهجية المكتب" },
  team_proposed: { en: "Proposed by the team", ar: "مقترح من الفريق" },
};

export const YES_NO_VALUES = ["yes", "partly", "no", "na"] as const;
export const RATING_VALUES = ["1", "2", "3", "4", "na"] as const;

export interface ChoiceOption {
  value: string;
  label: string;
  labelAr?: string;
  points: number;
}

/** A data rule's words (English, from the API) as a message key under "assessment.errors", or null. */
export function assessmentError(message: string | undefined): string | null {
  if (!message) return null;
  const rules: [RegExp, string][] = [
    [/name the source/, "needSource"],
    [/say where in the source/, "needLocator"],
    [/published version cannot be changed|published version is kept/, "published"],
    [/only version/, "onlyVersion"],
    [/every section at least one question/, "emptySection"],
    [/answer every question that applies/, "unanswered"],
    [/legal form first/, "legalForm"],
    [/publish the template before|published version of a template/, "notPublished"],
    [/template is archived/, "archived"],
    [/already a finding/, "alreadyFinding"],
    [/at least two options/, "options"],
    [/condition names|can depend only/, "condition"],
    [/either bound or guided/, "boundOrGuided"],
    [/finalise the assessment before/, "finaliseFirst"],
    [/attach a file of this project/, "evidenceFile"],
    [/refused by a data rule/, "refTaken"],
  ];
  return rules.find(([re]) => re.test(message))?.[1] ?? null;
}

/** The possible answers of a scored question, for the answer controls and conditions. */
export function answerValues(q: { type: QuestionType; options?: ChoiceOption[] | null }): string[] {
  if (q.type === "yes_no") return [...YES_NO_VALUES];
  if (q.type === "rating") return [...RATING_VALUES];
  if (q.type === "multiple_choice") return (q.options ?? []).map((o) => o.value);
  return [];
}
