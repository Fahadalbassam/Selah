import { z } from "zod";
import { NOT_COVERED } from "@/lib/engagements";
import { phaseFields } from "@/lib/phases";
import { route } from "@/server/http";
import { createClientProject } from "@/services/staffing";

const body = z
  .object({
    ...phaseFields,
    title: z.string().trim().min(2).max(200),
    // The firm admin may put it under one of the client's engagements; otherwise it is a draft.
    engagementId: z.preprocess((v) => (v === NOT_COVERED || v === "" ? null : v), z.uuid().nullable().optional()),
  })
  .strict();

/** Firm admin or the client's lead: a new project (phase, follow-on scope) for the client, a draft until an engagement covers it. */
export const POST = route({ params: z.object({ id: z.uuid() }), body }, ({ tx, principal, params, body }) =>
  createClientProject(tx, principal, params.id, body),
);
