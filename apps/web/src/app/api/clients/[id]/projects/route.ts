import { z } from "zod";
import { phaseFields } from "@/lib/phases";
import { route } from "@/server/http";
import { createClientProject } from "@/services/staffing";

const body = z.object({ ...phaseFields, title: z.string().trim().min(2).max(200) }).strict();

/** Firm admin or the client's lead: a new project (phase, follow-on scope) for the client. */
export const POST = route({ params: z.object({ id: z.uuid() }), body }, ({ tx, principal, params, body }) =>
  createClientProject(tx, principal, params.id, body),
);
