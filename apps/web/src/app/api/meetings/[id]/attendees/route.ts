import { z } from "zod";
import { route } from "@/server/http";
import { addAttendee } from "@/services/meetings";

const body = z.object({ userId: z.uuid().optional(), contactId: z.uuid().optional(), optional: z.boolean().optional() });

export const POST = route({ params: z.object({ id: z.uuid() }), body }, ({ tx, principal, params, body }) =>
  addAttendee(tx, principal, params.id, body),
);
