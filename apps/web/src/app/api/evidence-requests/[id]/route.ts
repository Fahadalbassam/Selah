import { z } from "zod";
import { route } from "@/server/http";
import { decideEvidenceRequest } from "@/services/follow-through";

const body = z.object({
  status: z.enum(["accepted", "rejected", "waived", "open"]),
  note: z.string().trim().min(1).max(4000).optional(),
});

export const PATCH = route({ params: z.object({ id: z.uuid() }), body }, ({ tx, principal, params, body }) =>
  decideEvidenceRequest(tx, principal, params.id, body),
);
