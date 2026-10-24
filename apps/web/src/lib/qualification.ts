import { z } from "zod";

// The qualification card's five signals (wave 1, item 8): 1 weak, 2 some,
// 3 strong. Same range as inquiry_qualification_range.
export const SIGNALS = ["fit", "need", "authority", "urgency", "budget"] as const;
export type Signal = (typeof SIGNALS)[number];

const rating = z.coerce.number().int().min(1).max(3);
export const qualificationInput = z
  .object({
    fit: rating,
    need: rating,
    authority: rating,
    urgency: rating,
    budget: rating,
    note: z.preprocess((v) => (typeof v === "string" ? v.trim() || null : v), z.string().max(1000).nullable()).default(null),
  })
  .strict();
export type QualificationInput = z.infer<typeof qualificationInput>;
