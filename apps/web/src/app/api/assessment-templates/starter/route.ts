import { z } from "zod";
import { route } from "@/server/http";
import { installStarterTemplate } from "@/services/assessments";

/** Add the starter family-governance template as a draft (or published, with publish: true). */
export const POST = route({ body: z.object({ publish: z.boolean().default(false) }) }, ({ tx, principal, body }) =>
  installStarterTemplate(tx, principal, body),
);
