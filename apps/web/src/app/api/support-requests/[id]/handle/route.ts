import { z } from "zod";
import { route } from "@/server/http";
import { handleSupportRequest } from "@/services/help";

/** The firm admin marks a reported problem handled (F13); its author is told. */
export const POST = route({ params: z.object({ id: z.uuid() }) }, ({ tx, principal, params }) => handleSupportRequest(tx, principal, params.id));
