import { z } from "zod";
import { createAttemptLimiter } from "@/auth/attempts";
import { keyRoute } from "@/server/http";
import { feedByKey, pushValues } from "@/services/indicator-data";

// A client's own system sends indicator figures (POST, Authorization: Bearer
// <key>). The key was created on the client's indicator data page and works
// while the client stays "connected". Figures go in under the name of who
// created the key, for the indicators the client lets connections fill. See
// docs/indicator-data.md for the request and answer.
const pushesPerKey = createAttemptLimiter({ max: 60, windowSeconds: 60 * 60 });

export const POST = keyRoute(
  {
    maxBytes: 512 * 1024,
    resolve: feedByKey,
    limit: (key) => pushesPerKey.take(key.id) === null,
    body: z.object({
      values: z
        .array(
          z.object({
            indicator: z.string().trim().min(1).max(100),
            period: z.string().trim().min(1).max(40),
            value: z.union([z.number().finite().min(-1e12).max(1e12), z.string().trim().min(1).max(40)]),
            note: z.string().trim().max(1000).nullable().optional(),
          }),
        )
        .min(1)
        .max(500),
    }),
  },
  ({ tx, principal, key, body }) => pushValues(tx, principal, { id: key.id, orgId: key.orgId }, body.values),
);
