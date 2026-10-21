import { z } from "zod";
import { route } from "@/server/http";
import { addInquiryNote } from "@/services/inquiries";

export const POST = route(
  { params: z.object({ id: z.uuid() }), body: z.object({ note: z.string().trim().min(1).max(4000) }) },
  ({ tx, principal, params, body }) => addInquiryNote(tx, principal, params.id, body.note),
);
