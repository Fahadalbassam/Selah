import { z } from "zod";
import { route } from "@/server/http";
import { meetingIcs } from "@/services/meetings";

export const GET = route({ params: z.object({ id: z.uuid() }) }, ({ tx, principal, params }) =>
  meetingIcs(tx, principal, params.id),
);
