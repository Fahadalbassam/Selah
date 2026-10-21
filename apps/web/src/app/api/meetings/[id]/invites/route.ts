import { z } from "zod";
import { route } from "@/server/http";
import { sendInvites } from "@/services/meetings";

// Queues the .ics invite (or cancellation) for each attendee with an address.
export const POST = route({ params: z.object({ id: z.uuid() }) }, ({ tx, principal, params }) =>
  sendInvites(tx, principal, params.id),
);
