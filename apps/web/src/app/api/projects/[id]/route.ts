import { z } from "zod";
import { phaseFields } from "@/lib/phases";
import { route } from "@/server/http";
import { updateProject } from "@/services/staffing";

const body = z.object(phaseFields).partial().strict();

/** Firm admin: correct a project's title, dates or place among the client's phases. */
export const PATCH = route({ params: z.object({ id: z.uuid() }), body }, ({ tx, principal, params, body }) =>
  updateProject(tx, principal, params.id, body),
);
