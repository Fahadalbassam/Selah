import { z } from "zod";
import { route } from "@/server/http";
import { confirmHeadSuggestion } from "@/services/org-chart";

// Confirm a department-head suggestion (org chart, part 5): the client's
// admin or the firm admin makes the person in a linked unit's head position
// the department's head in Selah. Nothing changes until someone confirms.
// Anyone else: 404.
export const POST = route(
  { params: z.object({ id: z.uuid() }), body: z.object({ departmentId: z.uuid(), userId: z.uuid() }) },
  ({ tx, principal, params, body }) => confirmHeadSuggestion(tx, principal, params.id, body),
);
