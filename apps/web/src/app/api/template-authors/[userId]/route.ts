import { z } from "zod";
import { route } from "@/server/http";
import { addTemplateAuthor, removeTemplateAuthor } from "@/services/assessments";

const params = z.object({ userId: z.uuid() });

/** The firm admin names a consultant as a template author, or stops. */
export const PUT = route({ params }, ({ tx, principal, params }) => addTemplateAuthor(tx, principal, params.userId));

export const DELETE = route({ params }, ({ tx, principal, params }) => removeTemplateAuthor(tx, principal, params.userId));
