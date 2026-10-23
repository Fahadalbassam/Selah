import { z } from "zod";
import { route } from "@/server/http";
import { getMailPreferences, setMailPreferences } from "@/services/notifications";

// The caller's own mail choices. Row-level security keeps each person to their own row.
const body = z.object({ followUpDigest: z.boolean() });

export const GET = route({}, ({ tx, principal }) => getMailPreferences(tx, principal));
export const PUT = route({ body }, ({ tx, principal, body }) => setMailPreferences(tx, principal, body));
