import { z } from "zod";
import { route } from "@/server/http";
import { audienceInput } from "@/services/audience";
import { getMeetingAudience, setMeetingAudience } from "@/services/meetings";

/** Who sees a meeting (feature A), for those who may change it (404 for anyone else). */
export const GET = route({ params: z.object({ id: z.uuid() }) }, ({ tx, principal, params }) =>
  getMeetingAudience(tx, principal, params.id),
);

/** Set, change or clear ("everyone") who sees it. It only takes people away. */
export const PUT = route({ params: z.object({ id: z.uuid() }), body: audienceInput }, ({ tx, principal, params, body }) =>
  setMeetingAudience(tx, principal, params.id, body),
);
