import { z } from "zod";
import { TRANSLATION_MAX_CHARS } from "@/lib/translations";
import { route } from "@/server/http";
import { reviewTranslation } from "@/services/translations";

// Firm staff correct a translation and mark it reviewed.
export const PATCH = route(
  { params: z.object({ id: z.uuid() }), body: z.object({ text: z.string().trim().min(1).max(TRANSLATION_MAX_CHARS).optional() }) },
  ({ tx, principal, params, body }) => reviewTranslation(tx, principal, params.id, body),
);
