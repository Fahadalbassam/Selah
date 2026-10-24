import { z } from "zod";
import { clientProfileInput } from "@/lib/client-profile";
import { route } from "@/server/http";
import { getClientProfile, setClientProfile } from "@/services/client-profile";

const params = z.object({ id: z.uuid() });

export const GET = route({ params }, ({ tx, principal, params }) => getClientProfile(tx, principal, params.id));

/** The client's legal profile (the firm admin and the client's lead; the legal form is the admin's). */
export const PUT = route({ params, body: clientProfileInput }, ({ tx, principal, params, body }) => setClientProfile(tx, principal, params.id, body));
