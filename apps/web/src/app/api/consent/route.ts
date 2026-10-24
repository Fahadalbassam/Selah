import { z } from "zod";
import { route } from "@/server/http";
import { acceptConsents } from "@/services/consent";

const version = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

// The first sign-in's acceptance of the terms, privacy notice and AI-use
// notice (R1): the versions the person was shown. The one route open before it.
export const POST = route(
  {
    allowConsentPending: true,
    body: z
      .object({ terms: version, privacy: version, ai_notice: version, locale: z.enum(["ar", "en"]) })
      .partial({ terms: true, privacy: true, ai_notice: true })
      .strict(),
  },
  ({ tx, principal, body, ip }) => {
    const { locale, ...accepted } = body;
    return acceptConsents(tx, principal, accepted, locale, ip);
  },
);
