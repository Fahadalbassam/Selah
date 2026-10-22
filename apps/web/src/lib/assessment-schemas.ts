import { z } from "zod";
import { LEGAL_FORMS, OWN_BASES, QUESTION_TYPES } from "./assessments";

// Request bodies for the assessment template routes.

const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();

export const templateBody = z.object({
  name: text(200),
  nameAr: optionalText(200),
  description: optionalText(2000),
  descriptionAr: optionalText(2000),
});

export const sectionBody = z.object({
  position: z.number().int().min(1).max(1000),
  title: text(200),
  titleAr: optionalText(200),
  description: optionalText(2000),
  descriptionAr: optionalText(2000),
});

export const questionBody = z.object({
  sectionId: z.uuid(),
  position: z.number().int().min(1).max(1000),
  ref: optionalText(20),
  prompt: text(1000),
  promptAr: optionalText(1000),
  guidance: optionalText(4000),
  guidanceAr: optionalText(4000),
  type: z.enum(QUESTION_TYPES),
  options: z
    .array(
      z.object({
        value: z.string().trim().min(1).max(50),
        label: text(200),
        labelAr: z.string().trim().max(200).optional(),
        points: z.number().int().min(0).max(10),
      }),
    )
    .min(2)
    .max(10)
    .nullable()
    .optional(),
  weight: z.number().int().min(1).max(3).default(1),
  gapMaxPoints: z.number().int().min(0).max(30).nullable().optional(),
  // Legal requirement and regulator guidance come only from legalFor and guidanceFor, per client.
  basis: z.enum(OWN_BASES),
  legalFor: z.array(z.enum(LEGAL_FORMS)).max(LEGAL_FORMS.length).nullable().optional(),
  guidanceFor: z.array(z.enum(LEGAL_FORMS)).max(LEGAL_FORMS.length).nullable().optional(),
  citation: optionalText(500),
  locator: optionalText(200),
  citationVerified: z.boolean().optional(),
  appliesIfQuestionId: z.uuid().nullable().optional(),
  appliesIfValues: z.array(z.string().trim().min(1).max(50)).min(1).max(10).nullable().optional(),
});
