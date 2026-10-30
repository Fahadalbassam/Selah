import { z } from "zod";
import { INDICATOR_DIRECTIONS, INDICATOR_FREQUENCIES, INDICATOR_LIMITS as L } from "./indicators";

// The API's shape for an indicator; the database checks the same limits.
const text = (max: number) => z.string().trim().max(max).nullable();
const firstOfMonth = z.iso.date().refine((d) => d.endsWith("-01"), "the 1st of a month");
// A number as typed: finite, and short enough to stay exact in a numeric column.
const amount = z.number().finite().min(-1e12).max(1e12);

export const indicatorFields = z.object({
  nameAr: text(L.name),
  nameEn: text(L.name),
  definition: text(L.definition),
  unit: z.string().trim().min(1).max(L.unit),
  direction: z.enum(INDICATOR_DIRECTIONS),
  frequency: z.enum(INDICATOR_FREQUENCIES),
  baseline: amount,
  baselinePeriod: firstOfMonth,
  target: amount.nullable(),
  targetDate: z.iso.date().nullable(),
  source: text(L.source),
  departmentId: z.uuid().nullable(),
  // The short key the client's files and systems use for it.
  code: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9_.-]{0,39}$/)
    .nullable()
    .optional(),
});

export const sourceChanges = z
  .object({ code: indicatorFields.shape.code, feedOn: z.boolean().optional() })
  .refine((b) => b.code !== undefined || b.feedOn !== undefined);

export const newIndicator = indicatorFields
  .refine((b) => !!(b.nameAr || b.nameEn), { message: "name the indicator", path: ["nameAr"] })
  .refine((b) => (b.target === null) === (b.targetDate === null), { message: "a target needs its date", path: ["targetDate"] })
  .refine((b) => b.targetDate === null || b.targetDate > b.baselinePeriod, { message: "the target date comes after the baseline", path: ["targetDate"] });

export const indicatorChanges = indicatorFields
  .extend({ active: z.boolean() })
  .partial()
  .refine((b) => Object.keys(b).length > 0);

export const newValue = z.object({
  period: firstOfMonth,
  value: amount,
  note: text(L.note).default(null),
  supersedesId: z.uuid().nullable().default(null),
});
