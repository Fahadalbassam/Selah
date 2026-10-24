import { z } from "zod";
import { AUDIT_AREAS, AUDIT_OUTCOMES } from "@/lib/audit";
import { route } from "@/server/http";
import { exportLocale } from "@/server/locale";
import { exportAuditCsv } from "@/services/audit-log";
import { download } from "@/services/exports";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const auditQuery = z.object({
  from: day.optional(),
  to: day.optional(),
  person: z.uuid().optional(),
  area: z.enum(Object.keys(AUDIT_AREAS) as [keyof typeof AUDIT_AREAS]).optional(),
  outcome: z.enum(AUDIT_OUTCOMES).optional(),
  org: z.uuid().optional(),
  lang: z.enum(["ar", "en"]).optional(),
});

// The filtered audit log as CSV, for the firm admin and client admins (R2).
export const GET = route({ query: auditQuery }, async ({ tx, principal, query }) => {
  const { lang, ...filters } = query;
  return download(await exportAuditCsv(tx, principal, filters, await exportLocale(lang)));
});
