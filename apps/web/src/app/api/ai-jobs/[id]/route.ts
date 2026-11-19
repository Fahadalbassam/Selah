import { z } from "zod";
import { route } from "@/server/http";
import { cancelJob, getJob } from "@/services/ai-jobs";

// A slow AI call filed as a job (a file summary, a translation, an org chart
// draft from pasted text; docs/assistant.md, "Slow calls as jobs"): the page
// asks where it stands every few seconds, and may cancel it. Only the person
// who asked sees their job; for anyone else, a 404.
export const GET = route({ params: z.object({ id: z.uuid() }) }, ({ tx, principal, params }) => getJob(tx, principal, params.id));

export const DELETE = route({ params: z.object({ id: z.uuid() }) }, ({ tx, principal, params }) => cancelJob(tx, principal, params.id));
