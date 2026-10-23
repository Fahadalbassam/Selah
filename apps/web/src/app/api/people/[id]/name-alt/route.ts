import { z } from "zod";
import { NAME_ALT_LENGTH } from "@/lib/masking";
import { route } from "@/server/http";
import { setNameAlt } from "@/services/accounts";

// The person's name in the other language, so it is masked in files written in either. Empty clears it.
export const PUT = route(
  { params: z.object({ id: z.uuid() }), body: z.object({ nameAlt: z.string().trim().max(NAME_ALT_LENGTH.person[1]) }) },
  ({ tx, principal, params, body }) => setNameAlt(tx, principal, params.id, body.nameAlt),
);
