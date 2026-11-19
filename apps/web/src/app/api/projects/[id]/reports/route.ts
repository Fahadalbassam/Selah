import { z } from "zod";
import { route } from "@/server/http";
import { listReports, snapshotReport } from "@/services/follow-through";

const params = z.object({ id: z.uuid() });

export const GET = route({ params }, ({ tx, principal, params }) => listReports(tx, principal, params.id));

const body = z.object({
  title: z.string().trim().min(1).max(300),
  periodStart: z.iso.date(),
  periodEnd: z.iso.date(),
  bodyMd: z.string().max(100_000).optional(),
  // "Use as draft": the assistant answer the note started from (the database checks it is the writer's own).
  draftMessageId: z.uuid().optional(),
});

export const POST = route({ params, body }, ({ tx, principal, params, body }) => snapshotReport(tx, principal, params.id, body));
