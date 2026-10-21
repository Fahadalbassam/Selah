import { z } from "zod";
import { route } from "@/server/http";
import { addActionNote, listActionNotes } from "@/services/follow-through";

const params = z.object({ id: z.uuid() });

export const GET = route({ params }, ({ tx, principal, params }) => listActionNotes(tx, principal, params.id));

export const POST = route(
  { params, body: z.object({ body: z.string().trim().min(1).max(8000) }) },
  ({ tx, principal, params, body }) => addActionNote(tx, principal, params.id, body),
);
