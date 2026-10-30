import { z } from "zod";
import { route } from "@/server/http";
import { connectSheet, createFeedKey } from "@/services/indicator-data";

// A connection: a sheet Selah reads once a day, or a key for the client's
// systems (shown once, in this answer only).
export const POST = route(
  {
    params: z.object({ id: z.uuid() }),
    body: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("sheet"), label: z.string().trim().min(1).max(100), url: z.string().trim().min(1).max(2000) }),
      z.object({ kind: z.literal("api"), label: z.string().trim().min(1).max(100) }),
    ]),
  },
  ({ tx, principal, params, body }) =>
    body.kind === "sheet" ? connectSheet(tx, principal, params.id, body) : createFeedKey(tx, principal, params.id, body),
);
