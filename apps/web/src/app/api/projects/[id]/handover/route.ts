import { z } from "zod";
import { route } from "@/server/http";
import { getHandover, setHandover } from "@/services/handover";

const params = z.object({ id: z.uuid() });
const body = z.object({ handoverOn: z.iso.date(), sponsorUserId: z.uuid().nullable() }).partial().strict();

export const GET = route({ params }, ({ tx, principal, params }) => getHandover(tx, principal, params.id));

/** Firm admin: the handover date (creates or moves the check-ins) and the client's sponsor. */
export const PATCH = route({ params, body }, ({ tx, principal, params, body }) => setHandover(tx, principal, params.id, body));
