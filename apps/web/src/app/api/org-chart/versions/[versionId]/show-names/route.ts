import { z } from "zod";
import { route } from "@/server/http";
import { setShowNames } from "@/services/org-chart";

// The client's admin decides whether the company's managers see the names of
// the people in positions on a published version (org chart, part 5; part
// 1's rule). Anyone else: 404.
export const POST = route({ params: z.object({ versionId: z.uuid() }), body: z.object({ on: z.boolean() }) }, ({ tx, principal, params, body }) =>
  setShowNames(tx, principal, params.versionId, body.on),
);
