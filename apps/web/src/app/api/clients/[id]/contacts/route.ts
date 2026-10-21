import { z } from "zod";
import { route } from "@/server/http";
import { createContact, listContacts } from "@/services/accounts";

const body = z.object({
  name: z.string().trim().min(1).max(120),
  title: z.string().trim().max(120).optional(),
  email: z.email().max(254).optional(),
  phone: z
    .string()
    .trim()
    .regex(/^[+0-9 ()-]{0,30}$/)
    .optional(),
});

export const GET = route({ params: z.object({ id: z.uuid() }) }, ({ tx, principal, params }) =>
  listContacts(tx, principal, params.id),
);
export const POST = route({ params: z.object({ id: z.uuid() }), body }, ({ tx, principal, params, body }) =>
  createContact(tx, principal, params.id, body),
);
