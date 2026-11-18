import { z } from "zod";
import { route } from "@/server/http";
import { personWork } from "@/services/org-chart";

// A person's work card on the drawn structure: their open tasks, what is
// late and their recent uploads, read as the person asking. Only for someone
// whose name the reader sees on that version of the structure (the same
// version as the Structure tab: "draft", a version's id, or the current one);
// anyone else, a typed name, another client: 404.
export const GET = route(
  {
    params: z.object({ id: z.uuid(), userId: z.uuid() }),
    query: z.object({ version: z.union([z.literal("draft"), z.uuid()]).optional() }),
  },
  ({ tx, principal, params, query }) => personWork(tx, principal, params.id, params.userId, query.version ?? null),
);
