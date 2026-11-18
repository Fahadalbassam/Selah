import { z } from "zod";
import { route } from "@/server/http";
import { audienceInput } from "@/services/audience";
import { getDocumentAudience, setDocumentAudience } from "@/services/documents";

/**
 * Who sees a file (feature A): its audience and the people who can already
 * see it, for those who may change it (404 for anyone else). `?shared=1`
 * lists them as if the firm shared the file with the client.
 */
export const GET = route(
  { params: z.object({ id: z.uuid() }), query: z.object({ shared: z.enum(["1"]).optional() }) },
  ({ tx, principal, params, query }) => getDocumentAudience(tx, principal, params.id, { asShared: query.shared === "1" }),
);

/** Set, change or clear ("everyone") who sees it. It only takes people away. */
export const PUT = route({ params: z.object({ id: z.uuid() }), body: audienceInput }, ({ tx, principal, params, body }) =>
  setDocumentAudience(tx, principal, params.id, body),
);
