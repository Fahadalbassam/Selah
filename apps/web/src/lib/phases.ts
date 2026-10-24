import { z } from "zod";

// A client project as one phase of the engagement (option B, decided
// 2026-10-24). The database checks the same ranges (projects_sequence_range,
// projects_planned_days_range); tests/db/rule-parity.test.ts compares them.
export const PHASE_LIMITS = { sequence: { min: 1, max: 99 }, plannedWorkingDays: { min: 1, max: 1000 } } as const;

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional().transform((v) => (v === undefined ? undefined : v || null));
const optionalInt = (r: { min: number; max: number }) => z.coerce.number().int().min(r.min).max(r.max).nullable().optional();

/** What a form's "follows" select sends for "no earlier project". */
export const NO_PREVIOUS = "none";

/** The fields a new or corrected client project takes. */
export const phaseFields = {
  title: z.string().trim().min(2).max(200),
  description: optionalText(2000),
  startDate: z.iso.date().nullable().optional(),
  endDate: z.iso.date().nullable().optional(),
  sequence: optionalInt(PHASE_LIMITS.sequence),
  plannedWorkingDays: optionalInt(PHASE_LIMITS.plannedWorkingDays),
  followsProjectId: z.preprocess((v) => (v === NO_PREVIOUS ? null : v), z.uuid().nullable().optional()),
};
