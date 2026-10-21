import { z } from "zod";
import { route } from "@/server/http";
import { discardDraft, getTemplateVersion } from "@/services/assessments";

const params = z.object({ id: z.uuid() });

/** A version's sections and questions (firm staff). */
export const GET = route({ params }, ({ tx, principal, params }) => getTemplateVersion(tx, principal, params.id));

/** Throw a draft away. */
export const DELETE = route({ params }, ({ tx, principal, params }) => discardDraft(tx, principal, params.id));
