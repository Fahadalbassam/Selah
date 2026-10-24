import { z } from "zod";
import { route } from "@/server/http";
import { issueStatusPack } from "@/services/status-pack";

const params = z.object({ id: z.uuid() });

/** Issue a drafted monthly status pack (F19) with the firm's note. It stays firm-only until shared. */
export const POST = route({ params, body: z.object({ bodyMd: z.string().max(8000).default("") }) }, ({ tx, principal, params, body }) =>
  issueStatusPack(tx, principal, params.id, body),
);
