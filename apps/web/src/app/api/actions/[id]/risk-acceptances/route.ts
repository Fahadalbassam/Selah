import { z } from "zod";
import { route } from "@/server/http";
import { listRiskAcceptances, signRiskAcceptance } from "@/services/follow-through";

const params = z.object({ id: z.uuid() });

export const GET = route({ params }, ({ tx, principal, params }) => listRiskAcceptances(tx, principal, params.id));

export const POST = route(
  { params, body: z.object({ statement: z.string().trim().min(10).max(4000) }) },
  ({ tx, principal, params, body }) => signRiskAcceptance(tx, principal, params.id, body),
);
