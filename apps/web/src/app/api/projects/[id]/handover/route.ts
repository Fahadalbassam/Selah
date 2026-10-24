import { z } from "zod";
import { route } from "@/server/http";
import { getHandover, setHandover } from "@/services/handover";

const params = z.object({ id: z.uuid() });
const body = z.object({ handoverOn: z.iso.date() }).partial().strict();

export const GET = route({ params }, ({ tx, principal, params }) => getHandover(tx, principal, params.id));

/** Firm admin: the handover date (creates or moves the check-ins). The sponsor is a client role. */
export const PATCH = route({ params, body }, ({ tx, principal, params, body }) => setHandover(tx, principal, params.id, body));
