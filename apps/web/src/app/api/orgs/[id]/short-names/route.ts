import { z } from "zod";
import { route } from "@/server/http";
import { setShortNames } from "@/services/engagement";

/** A company's short names (firm admin), one per line or comma. Masked before a hosted model sees them. */
export const PUT = route(
  { params: z.object({ id: z.uuid() }), body: z.object({ shortNames: z.string().max(1000) }) },
  ({ tx, principal, params, body }) => setShortNames(tx, principal, params.id, body.shortNames),
);
