import { route } from "@/server/http";
import { listTemplateAuthors } from "@/services/assessments";

/** The consultants who may build and publish templates (the firm admin always can). */
export const GET = route({}, ({ tx, principal }) => listTemplateAuthors(tx, principal));
