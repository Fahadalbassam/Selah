import { z } from "zod";

// The signed engagement (wave 1, item 5): what the firm admin records when
// the client signs. The database checks the rest (baseline: Engagements, 0008).

const optionalText = (max: number) =>
  z.preprocess((v) => (typeof v === "string" ? v.trim() || null : v), z.string().max(max).nullable().optional());
const optionalDate = z.preprocess((v) => (v === "" ? null : v), z.iso.date().nullable().optional());

/** What a form's engagement select sends for "not covered yet": the project stays a draft. */
export const NOT_COVERED = "none";

export const engagementFields = {
  title: z.string().trim().min(2).max(200),
  signedOn: z.iso.date(),
  contractRef: optionalText(100),
  scope: z.string().trim().min(2).max(4000),
  exclusions: optionalText(4000),
  dataAgreementOn: optionalDate,
  startsOn: optionalDate,
  endsOn: optionalDate,
  retainerFollows: z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean()).optional(),
};

export const engagementInput = z.object(engagementFields).refine((v) => !v.startsOn || !v.endsOn || v.endsOn >= v.startsOn, {
  message: "the engagement ends after it starts",
  path: ["endsOn"],
});

export type EngagementInput = z.infer<typeof engagementInput>;

export const deliverableInput = z.object({
  title: z.string().trim().min(2).max(300),
  acceptanceCriteria: optionalText(2000),
  dueOn: optionalDate,
  projectId: z.preprocess((v) => (v === NOT_COVERED || v === "" ? null : v), z.uuid().nullable().optional()),
});

export type DeliverableInput = z.infer<typeof deliverableInput>;
