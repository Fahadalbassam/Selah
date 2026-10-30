import { z } from "zod";
import { route } from "@/server/http";
import { previewSheet } from "@/services/indicator-data";

// Whether a sheet link can be read, and which indicators its labels match, before it is saved.
export const POST = route(
  { params: z.object({ id: z.uuid() }), body: z.object({ url: z.string().trim().min(1).max(2000) }) },
  ({ tx, principal, params, body }) => previewSheet(tx, principal, params.id, body.url),
);
