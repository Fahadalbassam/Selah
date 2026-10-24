import { z } from "zod";
import { route } from "@/server/http";
import { removeComment } from "@/services/comments";

/** The author takes back their own comment; the text goes and a marker stays. */
export const POST = route({ params: z.object({ id: z.uuid() }) }, ({ tx, principal, params }) => removeComment(tx, principal, params.id));
