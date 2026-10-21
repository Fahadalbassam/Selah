import { z } from "zod";
import { sectionBody } from "@/lib/assessment-schemas";
import { route } from "@/server/http";
import { deleteSection, updateSection } from "@/services/assessments";

const params = z.object({ id: z.uuid() });

export const PATCH = route(
  { params, body: sectionBody.partial().refine((b) => Object.keys(b).length > 0) },
  ({ tx, principal, params, body }) => updateSection(tx, principal, params.id, body),
);

export const DELETE = route({ params }, ({ tx, principal, params }) => deleteSection(tx, principal, params.id));
