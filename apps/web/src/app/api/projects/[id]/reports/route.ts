import { z } from "zod";
import { route } from "@/server/http";
import { snapshotReport } from "@/services/follow-through";

const body = z.object({
  title: z.string().trim().min(1).max(300),
  periodStart: z.iso.date(),
  periodEnd: z.iso.date(),
  bodyMd: z.string().max(100_000).optional(),
});

export const POST = route({ params: z.object({ id: z.uuid() }), body }, ({ tx, principal, params, body }) =>
  snapshotReport(tx, principal, params.id, body),
);
