import { z } from "zod";
import { route } from "@/server/http";
import { putDepartmentMember, removeDepartmentMember } from "@/services/engagement";

const params = z.object({ id: z.uuid(), userId: z.uuid() });

export const PUT = route({ params, body: z.object({ isHead: z.boolean().default(false) }) }, ({ tx, principal, params, body }) =>
  putDepartmentMember(tx, principal, params.id, params.userId, body),
);

export const DELETE = route({ params }, ({ tx, principal, params }) =>
  removeDepartmentMember(tx, principal, params.id, params.userId),
);
