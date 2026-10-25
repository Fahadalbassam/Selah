// A second consultant's sign-off on evidence (F22, migration 0062). The
// database holds the same rules (second_review_rule) and decides when one
// applies (app_action_needs_second_review); tests/db/second-review.test.ts
// checks the two agree.

/** A client's rule, from the lightest to the strictest; each includes the ones before. */
export const SECOND_REVIEW_RULES = ["off", "repeat_revisions", "high_priority", "all"] as const;
export type SecondReviewRule = (typeof SECOND_REVIEW_RULES)[number];

/** Why an action needs a second sign-off (app_second_review_state.reason). */
export const SECOND_REVIEW_REASONS = ["flag", "all", "high_priority", "repeat_revisions"] as const;
export type SecondReviewReason = (typeof SECOND_REVIEW_REASONS)[number];

/** Revision rounds after which "repeat_revisions" asks for a second consultant. */
export const REPEAT_REVISIONS = 2;

/** A sign-off note's longest length (review_signoffs_note). */
export const SIGN_OFF_NOTE_MAX = 4000;
