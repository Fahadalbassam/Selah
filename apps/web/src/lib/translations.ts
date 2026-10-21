// What can be translated (drizzle/0034_translations_rules.sql keeps the same
// list), and how the language of a text is told. Shared by the service, the
// routes and the screens.

export const TRANSLATABLE = {
  recommendation: ["title", "rationale", "target_outcome", "required_evidence"],
  action: ["title", "description", "blocked_reason", "closure_note"],
  finding: ["title", "description"],
  meeting_summary: ["main_points_md"],
  meeting_decision: ["text"],
  progress_update: ["body"],
  assessment_answer: ["comment"],
} as const;

export type TranslatableType = keyof typeof TRANSLATABLE;
export const TRANSLATABLE_TYPES = Object.keys(TRANSLATABLE) as TranslatableType[];

export function isTranslatable(entityType: string, field: string): boolean {
  return (TRANSLATABLE as Record<string, readonly string[]>)[entityType]?.includes(field) ?? false;
}

/** Arabic when Arabic letters are at least as many as Latin ones. Text is stored without a language, so it is told by its script. */
export function detectLang(text: string): "ar" | "en" {
  const arabic = text.match(/[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/g)?.length ?? 0;
  const latin = text.match(/[A-Za-z]/g)?.length ?? 0;
  return arabic >= latin && arabic > 0 ? "ar" : "en";
}
