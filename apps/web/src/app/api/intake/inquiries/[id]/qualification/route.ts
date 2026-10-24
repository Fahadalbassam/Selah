import { z } from "zod";
import { qualificationInput } from "@/lib/qualification";
import { route } from "@/server/http";
import { rateInquiry } from "@/services/inquiries";

/** Rate the inquiry on fit, need, authority, urgency and budget. */
export const PUT = route({ params: z.object({ id: z.uuid() }), body: qualificationInput }, ({ tx, principal, params, body }) =>
  rateInquiry(tx, principal, params.id, body),
);
