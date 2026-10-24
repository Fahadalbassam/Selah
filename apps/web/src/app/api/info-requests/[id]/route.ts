import { z } from "zod";
import { infoRequestEdit } from "@/lib/info-requests";
import { route } from "@/server/http";
import { deleteInfoRequest, updateInfoRequest } from "@/services/info-requests";

const params = z.object({ id: z.uuid() });

export const PATCH = route({ params, body: infoRequestEdit }, ({ tx, principal, params, body }) => updateInfoRequest(tx, principal, params.id, body));

/** Only an item nobody answered yet. */
export const DELETE = route({ params }, ({ tx, principal, params }) => deleteInfoRequest(tx, principal, params.id));
