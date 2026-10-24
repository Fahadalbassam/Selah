import { z } from "zod";
import { infoRequestInput } from "@/lib/info-requests";
import { route } from "@/server/http";
import { createInfoRequest, listInfoRequests } from "@/services/info-requests";

const params = z.object({ id: z.uuid() });

/** The project's information request list (item 9). */
export const GET = route({ params }, ({ tx, principal, params }) => listInfoRequests(tx, principal, params.id));

/** The firm adds an item of its own. */
export const POST = route({ params, body: infoRequestInput }, ({ tx, principal, params, body }) => createInfoRequest(tx, principal, params.id, body));
