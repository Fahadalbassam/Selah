import { z } from "zod";
import { TRANSLATABLE_TYPES } from "@/lib/translations";
import { route } from "@/server/http";
import { translate } from "@/services/translations";

// A text in the other language: the kept translation, or a new one from the
// model. POST because it may spend a model call.
const body = z.object({
  entityType: z.enum(TRANSLATABLE_TYPES as [string, ...string[]]),
  entityId: z.uuid(),
  field: z.string().regex(/^[a-z_]{1,40}$/),
  to: z.enum(["ar", "en"]),
});

export const POST = route({ body }, ({ tx, principal, body }) => translate(tx, principal, body));
