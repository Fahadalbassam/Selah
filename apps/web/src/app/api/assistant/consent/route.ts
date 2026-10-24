import { z } from "zod";
import { route } from "@/server/http";
import { consentClientAi, myClientAi, withdrawClientAi } from "@/services/client-ai";

export const GET = route({}, ({ tx, principal }) => myClientAi(tx, principal));

// The client's admin consents to the client assistant notice the firm offered (wave 3, F39), in the version shown.
export const POST = route(
  { body: z.object({ version: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), locale: z.enum(["ar", "en"]) }).strict() },
  ({ tx, principal, body }) => consentClientAi(tx, principal, body),
);

// ...and withdraws it at any time.
export const DELETE = route({}, ({ tx, principal }) => withdrawClientAi(tx, principal));
