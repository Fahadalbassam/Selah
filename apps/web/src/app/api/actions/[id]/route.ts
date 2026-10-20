import { z } from "zod";
import { route } from "@/server/http";
import { getAction } from "@/services/actions";

export const GET = route({ params: z.object({ id: z.uuid() }) }, ({ tx, principal, params }) =>
  getAction(tx, principal, params.id),
);
