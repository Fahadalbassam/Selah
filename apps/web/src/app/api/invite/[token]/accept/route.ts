import { z } from "zod";
import { publicRoute } from "@/server/http";
import { acceptInvitation } from "@/services/onboarding";

// Same password rules as Better Auth (src/auth/auth.ts).
const body = z.object({ name: z.string().trim().min(1).max(120), password: z.string().min(12).max(128) });

export const POST = publicRoute(
  { params: z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }), body, maxBytes: 4 * 1024 },
  ({ tx, params, body }) => acceptInvitation(tx, params.token, body),
);
