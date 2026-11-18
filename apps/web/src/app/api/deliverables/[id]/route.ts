import { z } from "zod";
import { route } from "@/server/http";
import { getDeliverable } from "@/services/deliverables";

/** One deliverable with its status word and every hand-over round the reader may see. */
export const GET = route({ params: z.object({ id: z.uuid() }) }, ({ tx, principal, params }) => getDeliverable(tx, principal, params.id));
