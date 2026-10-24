import { z } from "zod";
import { route } from "@/server/http";
import { runConflictSearch } from "@/services/conflicts";

/** The firm admin runs the conflict search for a client, such as a prospect being pitched; the result is kept. */
export const POST = route({ params: z.object({ id: z.uuid() }) }, ({ tx, principal, params }) => runConflictSearch(tx, principal, { orgId: params.id }));
