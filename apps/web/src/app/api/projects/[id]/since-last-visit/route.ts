import { z } from "zod";
import { route } from "@/server/http";
import { markVisited, sinceLastVisit } from "@/services/insight";

const params = z.object({ id: z.uuid() });

/** What moved since this person last opened the project. */
export const GET = route({ params }, ({ tx, principal, params }) => sinceLastVisit(tx, principal, params.id));

/** Mark the project as seen now (call once the dashboard has shown the list). */
export const PUT = route({ params }, ({ tx, principal, params }) => markVisited(tx, principal, params.id));
