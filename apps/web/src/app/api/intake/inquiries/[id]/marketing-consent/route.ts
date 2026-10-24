import { z } from "zod";
import { route } from "@/server/http";
import { withdrawMarketingConsent } from "@/services/inquiries";

/** The firm admin records that the requester withdrew the marketing consent. */
export const DELETE = route({ params: z.object({ id: z.uuid() }) }, ({ tx, principal, params }) =>
  withdrawMarketingConsent(tx, principal, params.id),
);
