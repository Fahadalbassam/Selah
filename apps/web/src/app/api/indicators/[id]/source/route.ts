import { z } from "zod";
import { sourceChanges } from "@/lib/indicator-schemas";
import { route } from "@/server/http";
import { setIndicatorSource } from "@/services/indicator-data";

// An indicator's code for files and systems, and whether connections may fill it.
export const PATCH = route({ params: z.object({ id: z.uuid() }), body: sourceChanges }, ({ tx, principal, params, body }) =>
  setIndicatorSource(tx, principal, params.id, body),
);
