import { z } from "zod";
import { GRACE_DAYS, OFFBOARDING_LIMITS } from "@/lib/offboarding";
import { route } from "@/server/http";
import { archiveClient, getOffboarding, restoreClient } from "@/services/offboarding";

const params = z.object({ id: z.uuid() });
const body = z.discriminatedUnion("step", [
  z
    .object({
      step: z.literal("archive"),
      graceDays: z.coerce.number().int().min(GRACE_DAYS.min).max(GRACE_DAYS.max),
      note: z.string().trim().max(OFFBOARDING_LIMITS.note).nullish(),
    })
    .strict(),
  z.object({ step: z.literal("restore"), reason: z.string().trim().min(OFFBOARDING_LIMITS.reason.min).max(OFFBOARDING_LIMITS.reason.max) }).strict(),
]);

/** Where the client stands in leaving: archived or not, what blocks it, holds and retention. */
export const GET = route({ params }, ({ tx, principal, params }) => getOffboarding(tx, principal, params.id));

/** Archive the client once every project is closed, or restore it with a reason (the firm admin). */
export const POST = route({ params, body }, ({ tx, principal, params, body }) =>
  body.step === "archive" ? archiveClient(tx, principal, params.id, body) : restoreClient(tx, principal, params.id, body),
);
