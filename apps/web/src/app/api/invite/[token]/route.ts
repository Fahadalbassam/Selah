import { z } from "zod";
import { publicRoute } from "@/server/http";
import { openInvitation } from "@/services/onboarding";

// What the invite page shows: who is invited, to which organisation. Public.
export const GET = publicRoute(
  { params: z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }), maxBytes: 0 },
  ({ tx, params }) => openInvitation(tx, params.token),
);
