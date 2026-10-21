import { z } from "zod";
import { route } from "@/server/http";
import { putProfile } from "@/services/expertise";

const code = z.string().trim().min(1).max(60);
const body = z.object({
  languages: z
    .array(z.enum(["ar", "en"]))
    .min(1)
    .max(2)
    .optional(),
  acceptingNewClients: z.boolean().optional(),
  services: z.array(code).max(20).optional(),
  sectors: z.array(code).max(20).optional(),
});

export const PUT = route({ params: z.object({ id: z.uuid() }), body }, ({ tx, principal, params, body }) =>
  putProfile(tx, principal, params.id, body),
);
