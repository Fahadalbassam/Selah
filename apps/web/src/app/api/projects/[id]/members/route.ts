import { z } from "zod";
import { route } from "@/server/http";
import { staffProject } from "@/services/staffing";

// "observer" reads and comments only (wave 1, N6).
const body = z.object({ userId: z.uuid(), as: z.enum(["member", "observer"]).optional() });

export const POST = route({ params: z.object({ id: z.uuid() }), body }, ({ tx, principal, params, body }) =>
  staffProject(tx, principal, params.id, body.userId, body.as === "observer"),
);
