import { z } from "zod";
import { indicatorChanges } from "@/lib/indicator-schemas";
import { route } from "@/server/http";
import { deleteIndicator, getIndicator, updateIndicator } from "@/services/indicators";

const params = z.object({ id: z.uuid() });

export const GET = route({ params }, ({ tx, principal, params }) => getIndicator(tx, principal, params.id));

export const PATCH = route({ params, body: indicatorChanges }, ({ tx, principal, params, body }) => updateIndicator(tx, principal, params.id, body));

// Only while it has no values; afterwards it is switched off with PATCH { active: false }.
export const DELETE = route({ params }, ({ tx, principal, params }) => deleteIndicator(tx, principal, params.id));
