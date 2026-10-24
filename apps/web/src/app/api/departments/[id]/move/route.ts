import { z } from "zod";
import { route } from "@/server/http";
import { departmentWorkToMove, moveDepartmentWork } from "@/services/engagement";

const params = z.object({ id: z.uuid() });

// What would move, for the dialog.
export const GET = route({ params }, ({ tx, principal, params }) => departmentWorkToMove(tx, principal, params.id));

export const POST = route(
  { params, body: z.object({ to: z.uuid(), switchOff: z.boolean().default(true) }) },
  ({ tx, principal, params, body }) => moveDepartmentWork(tx, principal, params.id, body),
);
