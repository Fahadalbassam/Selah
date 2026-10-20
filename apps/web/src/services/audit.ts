import "server-only";
import { asAnonymous, type Tx } from "@/db/client";
import { auditLog } from "@/db/schema";

export interface AuditEntry {
  actorId: string | null;
  orgId?: string | null;
  action: string;
  resourceType?: string;
  resourceId?: string;
  outcome: "allow" | "deny" | "error";
  reason?: string;
  ip?: string | null;
  /** Ids and counts only. Never document text, prompts or answers. */
  meta?: Record<string, string | number | boolean | null>;
}

/** Record inside the current transaction (rolled back with it). */
export async function audit(tx: Tx, entry: AuditEntry): Promise<void> {
  await tx.insert(auditLog).values(entry);
}

/** Record in its own transaction, so denials survive the request's rollback. */
export async function auditDetached(entry: AuditEntry): Promise<void> {
  await asAnonymous((tx) => audit(tx, entry));
}
