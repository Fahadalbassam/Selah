import { z } from "zod";
import { route } from "@/server/http";
import { confirmResponse } from "@/services/responses";

/** A colleague confirms a response the firm recorded for a consultant-managed client. */
export const POST = route({ params: z.object({ id: z.uuid() }) }, ({ tx, principal, params }) => confirmResponse(tx, principal, params.id));
