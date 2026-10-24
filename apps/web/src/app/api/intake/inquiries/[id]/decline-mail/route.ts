import { z } from "zod";
import { route } from "@/server/http";
import { mailDecline } from "@/services/inquiries";

/** The firm admin sends the requester a courteous decline, once (N10). */
export const POST = route({ params: z.object({ id: z.uuid() }) }, ({ tx, principal, params }) => mailDecline(tx, principal, params.id));
