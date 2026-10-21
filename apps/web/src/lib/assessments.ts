// Shared by the assessment routes and services (drizzle/0029_assessments_rules.sql).

export const LEGAL_FORMS = ["sole_proprietorship", "llc", "closed_jsc", "listed_jsc", "non_profit", "other"] as const;
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
