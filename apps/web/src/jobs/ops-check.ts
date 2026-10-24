// The alert job's checks that need the schema owner (R4): mail that keeps
// failing to send, and the audit log's sealing and nightly check. The web
// app's own checks come from /api/ready.
import type { Check } from "../lib/ops";

interface Queryable {
  query<R = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: R[] }>;
}

/** The audit chain is checked nightly; older than this, the nightly job isn't running. */
export const CHAIN_CHECK_MAX_HOURS = 30;
/** New audit entries are sealed every jobs round; older than this unsealed, sealing has stopped. */
export const UNSEALED_MAX_MINUTES = 60;
/** A mail still not sent after failing for this long is a relay problem. */
export const MAIL_STUCK_MINUTES = 30;

export async function ownerChecks(pool: Queryable): Promise<Check[]> {
  const { rows } = await pool.query<{
    stuck: number;
    gave_up: number;
    checked_at: Date | null;
    check_ok: boolean | null;
    unsealed: number;
  }>(`
    SELECT
      (SELECT count(*)::int FROM outbound_emails
        WHERE sent_at IS NULL AND failed_at IS NULL AND attempts > 0 AND created_at < now() - make_interval(mins => ${MAIL_STUCK_MINUTES})) AS stuck,
      (SELECT count(*)::int FROM outbound_emails WHERE failed_at > now() - interval '1 day') AS gave_up,
      (SELECT checked_at FROM audit_chain_checks ORDER BY checked_at DESC LIMIT 1) AS checked_at,
      (SELECT ok FROM audit_chain_checks ORDER BY checked_at DESC LIMIT 1) AS check_ok,
      (SELECT count(*)::int FROM audit_log
        WHERE chain_seq IS NULL AND created_at < now() - make_interval(mins => ${UNSEALED_MAX_MINUTES})) AS unsealed`);
  const r = rows[0]!;
  const hours = r.checked_at
    ? (Date.now() - r.checked_at.getTime()) / 3_600_000
    : Infinity;
  const fail = (name: string, error: string): Check => ({
    name,
    ok: false,
    critical: false,
    error,
  });
  const pass = (name: string): Check => ({ name, ok: true, critical: false });
  return [
    r.stuck
      ? fail(
          "mail",
          `${r.stuck} mails failing to send for over ${MAIL_STUCK_MINUTES} minutes`,
        )
      : r.gave_up
        ? fail("mail", `${r.gave_up} mails given up on in the last day`)
        : pass("mail"),
    r.check_ok === false
      ? fail("audit chain", "the last nightly check found the chain broken")
      : hours > CHAIN_CHECK_MAX_HOURS
        ? fail(
            "audit chain",
            r.checked_at
              ? `not checked for ${Math.floor(hours)} hours`
              : "never checked",
          )
        : pass("audit chain"),
    r.unsealed
      ? fail(
          "audit sealing",
          `${r.unsealed} entries unsealed for over ${UNSEALED_MAX_MINUTES} minutes`,
        )
      : pass("audit sealing"),
  ];
}
