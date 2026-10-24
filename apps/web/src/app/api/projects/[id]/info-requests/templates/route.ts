import { z } from "zod";
import { templateItemsInput } from "@/lib/info-requests";
import { route } from "@/server/http";
import { addTemplateItems } from "@/services/info-requests";

/** The firm adds items from the template list, with one owner and due date. */
export const POST = route({ params: z.object({ id: z.uuid() }), body: templateItemsInput }, ({ tx, principal, params, body }) =>
  addTemplateItems(tx, principal, params.id, body),
);
