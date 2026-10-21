import { z } from "zod";
import { sectionBody } from "@/lib/assessment-schemas";
import { route } from "@/server/http";
import { addSection } from "@/services/assessments";

export const POST = route({ params: z.object({ id: z.uuid() }), body: sectionBody }, ({ tx, principal, params, body }) =>
  addSection(tx, principal, params.id, body),
);
