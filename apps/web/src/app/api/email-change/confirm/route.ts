import { z } from "zod";
import { publicRoute } from "@/server/http";
import { confirmEmailChange } from "@/services/onboarding";

// The new address confirms an admin's change. Public; the token is the proof.
const body = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) });

export const POST = publicRoute({ body, maxBytes: 1024 }, ({ tx, body }) => confirmEmailChange(tx, body.token));
