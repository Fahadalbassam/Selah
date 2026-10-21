import { z } from "zod";
import { route } from "@/server/http";
import { publishVersion } from "@/services/assessments";

/** Publish a draft. It never changes afterwards; new assessments use it. */
export const POST = route({ params: z.object({ id: z.uuid() }) }, ({ tx, principal, params }) =>
  publishVersion(tx, principal, params.id),
);
