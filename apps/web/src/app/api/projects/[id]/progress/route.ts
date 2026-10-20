import { z } from "zod";
import { route } from "@/server/http";
import { projectProgress } from "@/services/follow-through";

export const GET = route({ params: z.object({ id: z.uuid() }) }, ({ tx, principal, params }) =>
  projectProgress(tx, principal, params.id),
);
