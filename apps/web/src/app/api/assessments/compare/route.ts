import { z } from "zod";
import { route } from "@/server/http";
import { compareAssessments } from "@/services/assessments";

// GET /api/assessments/compare?a=...&b=... (either order; the earlier comes first in the answer).
export const GET = route({ query: z.object({ a: z.uuid(), b: z.uuid() }) }, ({ tx, principal, query }) =>
  compareAssessments(tx, principal, query.a, query.b),
);
