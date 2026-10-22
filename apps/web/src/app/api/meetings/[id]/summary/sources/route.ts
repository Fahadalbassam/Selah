import { z } from "zod";
import { route } from "@/server/http";
import { addSummarySource } from "@/services/meetings";

// A summary line's source: a quoted transcript passage, or a page of a project file.
const body = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("transcript"), line: z.coerce.number().int().min(1), quote: z.string().trim().min(3).max(5000) }),
  z.object({
    kind: z.literal("document"),
    line: z.coerce.number().int().min(1),
    documentId: z.uuid(),
    page: z.coerce.number().int().min(1).max(10000),
  }),
]);

export const POST = route({ params: z.object({ id: z.uuid() }), body }, ({ tx, principal, params, body }) =>
  addSummarySource(tx, principal, params.id, body),
);
