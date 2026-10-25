import { z } from "zod";
import { newValue } from "@/lib/indicator-schemas";
import { route } from "@/server/http";
import { addValue } from "@/services/indicators";

export const POST = route({ params: z.object({ id: z.uuid() }), body: newValue }, ({ tx, principal, params, body }) =>
  addValue(tx, principal, params.id, body),
);
