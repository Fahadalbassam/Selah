import { z } from "zod";
import { route } from "@/server/http";
import { createAssessment, listAssessments } from "@/services/assessments";

const params = z.object({ id: z.uuid() });

/** The project's assessments with their totals. Clients see the final ones the firm shared. */
export const GET = route({ params }, ({ tx, principal, params }) => listAssessments(tx, principal, params.id));

/** Assess the project against a template's latest published version. */
export const POST = route(
  { params, body: z.object({ templateId: z.uuid(), title: z.string().trim().min(1).max(200) }) },
  ({ tx, principal, params, body }) => createAssessment(tx, principal, params.id, body),
);
