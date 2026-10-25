import { z } from "zod";
import { newIndicator } from "@/lib/indicator-schemas";
import { route } from "@/server/http";
import { createIndicator, listIndicators } from "@/services/indicators";

const params = z.object({ id: z.uuid() });

export const GET = route({ params }, ({ tx, principal, params }) => listIndicators(tx, principal, params.id));

export const POST = route({ params, body: newIndicator }, ({ tx, principal, params, body }) => createIndicator(tx, principal, params.id, body));
