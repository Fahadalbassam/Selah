import { z } from "zod";
import { route } from "@/server/http";
import { withdrawRequest } from "@/services/staffing";

export const POST = route({ params: z.object({ id: z.uuid() }) }, ({ tx, principal, params }) => withdrawRequest(tx, principal, params.id));
