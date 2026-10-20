import { z } from "zod";
import { route } from "@/server/http";
import { addEvidenceRequest, listEvidenceRequests } from "@/services/follow-through";

const params = z.object({ id: z.uuid() });

export const GET = route({ params }, ({ tx, principal, params }) => listEvidenceRequests(tx, principal, params.id));

const body = z.object({
  title: z.string().trim().min(1).max(300),
  description: z.string().trim().max(4000).optional(),
  dueDate: z.iso.date().optional(),
});

export const POST = route({ params, body }, ({ tx, principal, params, body }) =>
  addEvidenceRequest(tx, principal, params.id, body),
);
