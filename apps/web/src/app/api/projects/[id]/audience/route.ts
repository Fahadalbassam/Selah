import { z } from "zod";
import { route } from "@/server/http";
import { newItemAudiencePeople } from "@/services/audience";

const ids = z
  .string()
  .max(4000)
  .optional()
  .transform((s) => (s ? s.split(",").filter(Boolean) : []))
  .pipe(z.array(z.uuid()).max(100));

/**
 * The people a new file or meeting of this project would be seen by, for the
 * picker in the upload and booking forms (feature A): from what the form says,
 * worked out by the database. Saving checks again on the item itself.
 */
export const GET = route(
  {
    params: z.object({ id: z.uuid() }),
    query: z.object({
      kind: z.enum(["document", "meeting"]),
      visibility: z.enum(["shared", "firm_private", "client_private"]),
      departmentId: z.uuid().optional(),
      attendees: ids,
    }),
  },
  ({ tx, principal, params, query }) =>
    newItemAudiencePeople(tx, principal, params.id, query.kind, {
      visibility: query.visibility,
      departmentId: query.departmentId ?? null,
      attendees: query.attendees,
    }),
);
