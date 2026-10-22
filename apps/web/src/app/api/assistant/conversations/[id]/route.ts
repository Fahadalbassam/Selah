import { z } from "zod";
import { route } from "@/server/http";
import { deleteConversation, getConversation, updateConversation } from "@/services/assistant";

const params = z.object({ id: z.uuid() });

/** One chat with its messages; answers in the other language come with their kept translation. */
export const GET = route({ params, query: z.object({ lang: z.enum(["ar", "en"]) }) }, ({ tx, principal, params, query }) =>
  getConversation(tx, principal, params.id, query.lang),
);

/** Rename, keep out of auto-archiving, archive or bring back. */
export const PATCH = route(
  {
    params,
    body: z
      .object({ title: z.string().trim().min(1).max(120), keep: z.boolean(), archived: z.boolean() })
      .partial()
      .strict(),
  },
  ({ tx, principal, params, body }) => updateConversation(tx, principal, params.id, body),
);

/** Delete now, with its translations. */
export const DELETE = route({ params }, ({ tx, principal, params }) => deleteConversation(tx, principal, params.id));
