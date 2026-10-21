import { z } from "zod";
import { route } from "@/server/http";
import { removeAttendee } from "@/services/meetings";

export const DELETE = route({ params: z.object({ id: z.uuid(), attendeeId: z.uuid() }) }, ({ tx, principal, params }) =>
  removeAttendee(tx, principal, params.id, params.attendeeId),
);
