import { z } from "zod";
import { route } from "@/server/http";
import { listConversations } from "@/services/assistant";

/** The signed-in person's chats, newest first. ?archived=1 lists the archived ones. */
export const GET = route({ query: z.object({ archived: z.enum(["0", "1"]).optional() }) }, ({ tx, principal, query }) =>
  listConversations(tx, principal, { archived: query.archived === "1" }),
);
