import type { Pool } from "pg";

/**
 * Empty the audit log between test files. The log refuses TRUNCATE even from
 * its owner, so this switches the guard off for the moment, which only the
 * owner can, and starts the hash chain again. (That the owner can do this is
 * why the chain exists: production has no such step, and a check after it
 * would fail.)
 */
export async function truncateAuditLog(owner: Pool): Promise<void> {
  await owner.query(`BEGIN;
    ALTER TABLE audit_log DISABLE TRIGGER audit_log_no_truncate;
    TRUNCATE audit_log;
    ALTER TABLE audit_log ENABLE TRIGGER audit_log_no_truncate;
    ALTER TABLE audit_chain DISABLE TRIGGER audit_chain_forward;
    UPDATE audit_chain SET anchor_seq = 0, anchor_hash = repeat('0', 64), head_seq = 0, head_hash = repeat('0', 64), pruned_at = NULL;
    ALTER TABLE audit_chain ENABLE TRIGGER audit_chain_forward;
    ALTER TABLE audit_chain_checks DISABLE TRIGGER append_only;
    DELETE FROM audit_chain_checks;
    ALTER TABLE audit_chain_checks ENABLE TRIGGER append_only;
    COMMIT`);
}
