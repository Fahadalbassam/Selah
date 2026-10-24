import { z } from "zod";
import { route } from "@/server/http";
import { createRecommendation } from "@/services/plan";

const text = (max: number) => z.string().trim().min(1).max(max).optional();
const body = z.object({
  title: z.string().trim().min(1).max(300),
  findingId: z.uuid().optional(),
  rationale: text(8000),
  targetOutcome: text(4000),
  priority: z.enum(["low", "medium", "high", "critical"]).default("medium"),
  dueDate: z.iso.date().optional(),
  requiredEvidence: text(4000),
  source: z.enum(["consultant", "board_decision", "compliance"]).default("consultant"),
  decidedOn: z.iso.date().optional(),
  meetingNoteId: z.uuid().optional(),
  visibility: z.enum(["shared", "firm_private"]).default("shared"),
  departmentId: z.uuid().optional(),
  accountableUserId: z.uuid().optional(),
});

export const POST = route({ params: z.object({ id: z.uuid() }), body }, ({ tx, principal, params, body }) =>
  createRecommendation(tx, principal, params.id, body),
);
