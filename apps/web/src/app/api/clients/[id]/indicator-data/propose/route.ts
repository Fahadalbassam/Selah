import { z } from "zod";
import { route } from "@/server/http";
import { proposeDataMode } from "@/services/indicator-data";

// The firm suggests a mode after discovery; the client's admin confirms it.
export const POST = route(
  { params: z.object({ id: z.uuid() }), body: z.object({ mode: z.enum(["typed", "files", "connected"]) }) },
  ({ tx, principal, params, body }) => proposeDataMode(tx, principal, params.id, body.mode),
);
