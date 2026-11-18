import { z } from "zod";
import { handOverInput } from "@/lib/deliverables";
import { route } from "@/server/http";
import { handOverChoices, handOverDeliverable } from "@/services/deliverables";

const params = z.object({ id: z.uuid() });

/** The files a deliverable can be handed over with (the dialog's list). */
export const GET = route({ params }, ({ tx, principal, params }) => handOverChoices(tx, principal, params.id));

/** Hand it over: the exact versions picked, as a new round. The client's lead, deputy or a staffed consultant. */
export const POST = route({ params, body: handOverInput }, ({ tx, principal, params, body }) =>
  handOverDeliverable(tx, principal, params.id, body.versionIds),
);
