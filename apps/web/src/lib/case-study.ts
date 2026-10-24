// Case-study consent (F37, migration: Case-study consent). Shared by the
// screen, the service and the tests; the database holds the same list (the
// case_study_level enum) and limits, and tests/db/case-study.test.ts proves they agree.

/** How the firm may cite the project, from nothing to naming the client. */
export const CASE_STUDY_LEVELS = ["none", "metrics_only", "anonymised", "named"] as const;
export type CaseStudyLevel = (typeof CASE_STUDY_LEVELS)[number];

export const CASE_STUDY_LIMITS = { conditions: 2000, source: { min: 5, max: 2000 } } as const;
