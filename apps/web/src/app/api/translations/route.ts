import { z } from "zod";
import { TRANSLATABLE_TYPES } from "@/lib/translations";
import { route } from "@/server/http";
import { maskingOn } from "@/services/masking";
import { translate } from "@/services/translations";

// A text in the other language: the kept translation, or a new one from the
// model. POST because it may spend a model call.
const body = z.object({
  entityType: z.enum(TRANSLATABLE_TYPES as [string, ...string[]]),
  entityId: z.uuid(),
  field: z.string().regex(/^[a-z_]{1,40}$/),
  to: z.enum(["ar", "en"]),
});

// Whether names are masked is asked of the AI service before the transaction opens (prepare).
export const POST = route({ body, prepare: () => maskingOn() }, ({ tx, principal, body, prepared }) => translate(tx, principal, body, prepared));
