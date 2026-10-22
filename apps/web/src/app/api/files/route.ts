import { z } from "zod";
import { route } from "@/server/http";
import { listFiles } from "@/services/files";

// The file explorer: every file the signed-in person can open, from the
// database (never a bucket listing). With actionId, only that action's client.
export const GET = route({ query: z.object({ actionId: z.uuid().optional() }) }, ({ tx, principal, query }) =>
  listFiles(tx, principal, { actionId: query.actionId }),
);
