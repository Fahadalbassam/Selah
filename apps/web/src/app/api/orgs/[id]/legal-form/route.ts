import { z } from "zod";
import { LEGAL_FORMS } from "@/lib/assessments";
import { route } from "@/server/http";
import { setLegalForm } from "@/services/assessments";

/** The client's legal form (firm admin). It decides which assessment criteria are legal requirements for it. */
export const PUT = route(
  { params: z.object({ id: z.uuid() }), body: z.object({ legalForm: z.enum(LEGAL_FORMS).nullable() }) },
  ({ tx, principal, params, body }) => setLegalForm(tx, principal, params.id, body.legalForm),
);
