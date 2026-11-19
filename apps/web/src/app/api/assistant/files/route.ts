import { z } from "zod";
import { route } from "@/server/http";
import { attachableFiles } from "@/services/assistant";

const query = z.object({
  locale: z.enum(["ar", "en"]).default("ar"),
  // Left out: a chat across every project the person may ask about.
  project: z.uuid().optional(),
  q: z.string().max(80).default(""),
});

/** The assistant's "@" picker: files the person can already open, by name, with whether the assistant can read each. */
export const GET = route({ query }, ({ tx, principal, query: q }) =>
  attachableFiles(tx, principal, { projectId: q.project ?? null, query: q.q, locale: q.locale }),
);
