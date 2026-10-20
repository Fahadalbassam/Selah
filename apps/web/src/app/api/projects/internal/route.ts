import { z } from "zod";
import { route } from "@/server/http";
import { createInternalProject } from "@/services/staffing";

const body = z.object({
  title: z.string().trim().min(2).max(200),
  description: z.string().trim().max(2000).optional(),
});

export const POST = route({ body }, ({ tx, principal, body }) =>
  createInternalProject(tx, principal, { title: body.title, description: body.description || undefined }),
);
