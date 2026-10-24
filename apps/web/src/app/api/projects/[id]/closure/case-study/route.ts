import { z } from "zod";
import { CASE_STUDY_LEVELS, CASE_STUDY_LIMITS } from "@/lib/case-study";
import { route } from "@/server/http";
import { recordCaseStudyConsent, revokeCaseStudyConsent } from "@/services/case-study";

const params = z.object({ id: z.uuid() });

/** The client's sponsor or admin gives (or changes) case-study consent; the firm admin records one given outside Selah. */
export const PUT = route(
  {
    params,
    body: z
      .object({
        level: z.enum(CASE_STUDY_LEVELS),
        // A form's yes or no.
        testimonial: z.union([z.boolean(), z.enum(["yes", "no"]).transform((v) => v === "yes")]),
        conditions: z.string().trim().max(CASE_STUDY_LIMITS.conditions).nullish(),
        sourceNote: z.string().trim().min(CASE_STUDY_LIMITS.source.min).max(CASE_STUDY_LIMITS.source.max).nullish(),
      })
      .strict(),
  },
  ({ tx, principal, params, body }) => recordCaseStudyConsent(tx, principal, params.id, body),
);

/** The client's sponsor or admin withdraws the consent in force. */
export const DELETE = route({ params }, ({ tx, principal, params }) => revokeCaseStudyConsent(tx, principal, params.id));
