import { z } from "zod";
import { route } from "@/server/http";
import { ask } from "@/services/assistant";

const body = z.object({
  projectId: z.uuid(),
  question: z.string().trim().min(1).max(2000),
  conversationId: z.uuid().optional(),
  language: z.enum(["ar", "en", "auto"]).default("auto"),
});

export const POST = route({ body }, ({ tx, principal, body }) => ask(tx, principal, body));
