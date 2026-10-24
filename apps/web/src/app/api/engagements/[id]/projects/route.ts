import { z } from "zod";
import { route } from "@/server/http";
import { coverProjects } from "@/services/engagements";

const body = z.object({ projectIds: z.array(z.uuid()).min(1).max(50) }).strict();

/** Firm admin: bring draft projects of the client under the engagement; they become planned. */
export const POST = route({ params: z.object({ id: z.uuid() }), body }, ({ tx, principal, params, body }) =>
  coverProjects(tx, principal, params.id, body.projectIds),
);
