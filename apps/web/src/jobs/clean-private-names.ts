// Before go-live, once (owner decision D8, Gate B; review of #193, S1):
// remove the private file name and the reason from rows written before
// migration 0106, where the other side could read them.
//
//   audit_log        action 'document.withdraw'   meta.title
//   activity_events  event  'document_withdrawn'  meta.title, meta.reason
//
// 0106 stopped new rows carrying them and hides the old ones when they are
// read (app_audit_entries drops the title; the document_label policy hides the
// event from the side the file's label keeps out). The stored rows still hold
// them, so a backup, an owner query or a future read path would show them.
// This blanks those fields and leaves a marker ("redacted": true). It also
// gives each old withdrawal event its file's own label, the rule 0106 uses
// for new ones (they were stored "shared" whatever the file's label). It never
// deletes a row. Rows written since 0106 carry neither field, so the rows to
// clean are found by their content, not by a date, and a second run finds
// nothing: it is idempotent.
//
// Run by the schema owner (scripts/pre-go-live/clean-private-names.ts), with
// the web app and the jobs stopped. A dry run changes nothing and prints
// counts per kind and per organisation, never a name.

// A pg Pool, described here (as in ops-check) so this module needs no raw
// driver import: it runs only from the owner's script and the DB test.
interface Client {
  query<R = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: R[] }>;
  release(): void;
}
interface Connectable {
  connect(): Promise<Client>;
}

/** Fields that held the private name and reason. Both are removed wherever present. */
const FIELDS = ["title", "reason"] as const;
const HAS_FIELDS = `meta ?| array['title','reason']`;
const BLANKED = `(meta - 'title' - 'reason') || '{"redacted": true}'::jsonb`;

/** An old withdrawal event: one still holding the fields, or one this script already blanked. */
const OLD_EVENT = `t.event = 'document_withdrawn' AND t.entity_type = 'document' AND (t.${HAS_FIELDS} OR t.meta @> '{"redacted": true}')`;
/** An old withdrawal event whose label is not its file's (0106 writes new ones with d.visibility). */
const WRONG_LABEL = `${OLD_EVENT} AND EXISTS (SELECT 1 FROM documents d WHERE d.id = t.entity_id AND d.visibility IS DISTINCT FROM t.visibility)`;

/** The row kinds #193 found carrying a private file name (or the wrong label) to the other side. */
export const KINDS = [
  { kind: "audit_log document.withdraw", table: "audit_log", match: `t.action = 'document.withdraw' AND t.${HAS_FIELDS}` },
  { kind: "activity_events document_withdrawn", table: "activity_events", match: `t.event = 'document_withdrawn' AND t.${HAS_FIELDS}` },
  { kind: "activity_events document_withdrawn label", table: "activity_events", match: WRONG_LABEL },
] as const;
export type Kind = (typeof KINDS)[number]["kind"];

/** The system event this writes to the audit log (counts only). */
export const CLEAN_ACTION = "audit_log.redact_private_names";

export interface CountRow {
  kind: Kind;
  orgId: string | null;
  orgKind: string | null;
  rows: number;
}
export interface CleanReport {
  database: string;
  applied: boolean;
  counts: CountRow[];
  totals: Record<Kind, number>;
  /** Sealed audit rows whose hash was recomputed (the changed ones and every one after them). */
  rehashed: number;
  rehashedFrom: number | null;
}
export interface CleanOptions {
  apply?: boolean;
  /** The database name, typed by the person running it. Required with apply. */
  confirm?: string;
  /** Allow a database whose name looks like a test or check copy. */
  allowTest?: boolean;
}

/** Names like selah_test, selah_test_t, selah_check, ci_selah: refused unless allowTest. */
export const looksLikeTestDatabase = (name: string) => /test|check|(^|_)ci($|_)|tmp|scratch/i.test(name);

async function counts(c: Client): Promise<CountRow[]> {
  const out: CountRow[] = [];
  for (const k of KINDS) {
    const { rows } = await c.query<{ org_id: string | null; org_kind: string | null; n: number }>(
      `SELECT t.org_id, o.kind::text AS org_kind, count(*)::int AS n
       FROM ${k.table} t LEFT JOIN organizations o ON o.id = t.org_id
       WHERE ${k.match}
       GROUP BY t.org_id, o.kind ORDER BY t.org_id NULLS FIRST`,
    );
    for (const r of rows) out.push({ kind: k.kind, orgId: r.org_id, orgKind: r.org_kind, rows: r.n });
  }
  return out;
}

const totalsOf = (list: CountRow[]) =>
  Object.fromEntries(KINDS.map((k) => [k.kind, list.filter((r) => r.kind === k.kind).reduce((s, r) => s + r.rows, 0)])) as Record<Kind, number>;

/**
 * Dry run (default) or apply. Everything happens in one transaction; on any
 * error it rolls back and nothing is changed, the audit log's guard included.
 */
export async function cleanPrivateNames(pool: Connectable, opts: CleanOptions = {}): Promise<CleanReport> {
  const c = await pool.connect();
  try {
    const me = (
      await c.query<{ db: string; owns: boolean }>(
        `SELECT current_database() AS db,
                pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid = 'public.audit_log'::regclass)) = current_user AS owns`,
      )
    ).rows[0]!;
    if (looksLikeTestDatabase(me.db) && !opts.allowTest) {
      throw new Error(`"${me.db}" looks like a test or check database; pass --allow-test to run against it`);
    }
    if (!me.owns) throw new Error("run this as the schema owner (DATABASE_OWNER_URL)");
    if (opts.apply && opts.confirm !== me.db) {
      throw new Error(`not confirmed: type the database name "${me.db}" exactly to apply`);
    }

    if (!opts.apply) {
      // Read only: no lock, no chain check (it records its result), nothing written.
      await c.query("BEGIN READ ONLY");
      const list = await counts(c);
      const from = (
        await c.query<{ s: string | null }>(
          `SELECT min(chain_seq)::text AS s FROM audit_log t WHERE ${KINDS[0].match}`,
        )
      ).rows[0]!.s;
      const rehash = from
        ? (await c.query<{ n: number }>(`SELECT count(*)::int AS n FROM audit_log WHERE chain_seq >= $1`, [from])).rows[0]!.n
        : 0;
      await c.query("ROLLBACK");
      return { database: me.db, applied: false, counts: list, totals: totalsOf(list), rehashed: rehash, rehashedFrom: from ? Number(from) : null };
    }

    await c.query("BEGIN");
    // Hold both tables still until commit: the app's inserts wait (they need
    // ROW EXCLUSIVE, which conflicts), and so does the sealing job, which also
    // takes the seal lock below.
    await c.query(`LOCK TABLE audit_log, activity_events IN SHARE ROW EXCLUSIVE MODE`);
    await c.query(`SELECT pg_advisory_xact_lock(hashtext('selah.audit_seal'))`);

    // Re-hashing a chain that is already broken would hide whatever broke it.
    const before = (await c.query<{ ok: boolean; first_bad_seq: string | null }>(`SELECT ok, first_bad_seq FROM app_check_audit_chain()`)).rows[0]!;
    if (!before.ok) throw new Error(`the audit chain is already broken at entry ${before.first_bad_seq}; nothing was changed. Find out why first.`);

    const list = await counts(c);
    const totals = totalsOf(list);
    if (Object.values(totals).every((n) => n === 0)) {
      await c.query("ROLLBACK");
      return { database: me.db, applied: true, counts: [], totals, rehashed: 0, rehashedFrom: null };
    }
    const oldHead = (await c.query<{ head_hash: string }>(`SELECT head_hash FROM audit_chain`)).rows[0]!.head_hash;

    // The audit log's guard (0023, audit_log_guard) refuses every UPDATE except
    // the sealing job's, and has no purge path. The owner switches it off here,
    // inside this transaction only: ALTER TABLE is transactional in Postgres,
    // so it comes back on below, and on any error the rollback restores it
    // too. The SHARE ROW EXCLUSIVE lock above means no other session writes to
    // the table while it is off. The TRUNCATE guard stays on throughout.
    await c.query(`ALTER TABLE audit_log DISABLE TRIGGER audit_log_guard`);
    const changed = await c.query<{ chain_seq: string | null }>(
      `UPDATE audit_log t SET meta = ${BLANKED} WHERE ${KINDS[0].match} RETURNING t.chain_seq::text`,
    );
    const sealed = changed.rows.map((r) => r.chain_seq).filter((s): s is string => s !== null).map(Number);
    const from = sealed.length ? Math.min(...sealed) : null;

    // The hash chain covers meta, so every sealed row from the first changed
    // one on gets its hash recomputed, the same way app_seal_audit_log made it,
    // and the chain's head moves to the new last hash. Unsealed rows are
    // sealed later by the job with their new content. The places (chain_seq)
    // do not move. The old and new head go into the system event below, so a
    // head copied off the server before today can be matched to this run.
    let rehashed = 0;
    if (from !== null) {
      await c.query(`SELECT set_config('selah.rehash_from', $1, true)`, [String(from)]);
      await c.query(`DO $$
        DECLARE
          ch audit_chain%ROWTYPE;
          r audit_log%ROWTYPE;
          s bigint := current_setting('selah.rehash_from')::bigint;
          h text;
        BEGIN
          SELECT * INTO ch FROM audit_chain FOR UPDATE;
          IF s - 1 = ch.anchor_seq THEN
            h := ch.anchor_hash;
          ELSE
            SELECT chain_hash INTO STRICT h FROM audit_log WHERE chain_seq = s - 1;
          END IF;
          FOR r IN SELECT * FROM audit_log WHERE chain_seq >= s ORDER BY chain_seq LOOP
            h := app_audit_hash(h, r.chain_seq, r);
            UPDATE audit_log SET chain_hash = h WHERE id = r.id;
          END LOOP;
          UPDATE audit_chain SET head_hash = h;
        END $$`);
      rehashed = (await c.query<{ n: number }>(`SELECT count(*)::int AS n FROM audit_log WHERE chain_seq >= $1`, [from])).rows[0]!.n;
    }
    await c.query(`ALTER TABLE audit_log ENABLE TRIGGER audit_log_guard`);

    // activity_events is append-only through forbid_change(), which already
    // lets the owner update under the selah.purge flag (the purge jobs' path),
    // so no trigger is switched off for it. The flag is local to this
    // transaction and cleared straight after.
    // The label first (its match also knows rows already blanked), then the fields.
    await c.query(`SELECT set_config('selah.purge', 'on', true)`);
    await c.query(
      `UPDATE activity_events t SET visibility = d.visibility FROM documents d WHERE d.id = t.entity_id AND ${KINDS[2].match}`,
    );
    await c.query(`UPDATE activity_events t SET meta = ${BLANKED} WHERE ${KINDS[1].match}`);
    await c.query(`SELECT set_config('selah.purge', '', true)`);

    const after = (await c.query<{ ok: boolean; first_bad_seq: string | null }>(`SELECT ok, first_bad_seq FROM app_check_audit_chain()`)).rows[0]!;
    if (!after.ok) throw new Error(`the audit chain did not check after re-hashing (entry ${after.first_bad_seq}); rolled back, nothing was changed`);
    const newHead = (await c.query<{ head_hash: string }>(`SELECT head_hash FROM audit_chain`)).rows[0]!.head_hash;

    // The system event: counts and hashes only, no names.
    await c.query(
      `INSERT INTO audit_log (actor_id, org_id, action, resource_type, resource_id, outcome, meta)
       VALUES (NULL, NULL, 'audit_log.redact_private_names', NULL, NULL, 'allow', $1::jsonb)`,
      [
        JSON.stringify({
          audit_rows: totals["audit_log document.withdraw"],
          activity_rows: totals["activity_events document_withdrawn"],
          activity_labels_set: totals["activity_events document_withdrawn label"],
          organisations: new Set(list.map((r) => r.orgId)).size,
          fields: FIELDS.join(","),
          rehashed_from: from,
          rehashed_rows: rehashed,
          previous_head_hash: oldHead,
          head_hash: newHead,
        }),
      ],
    );
    await c.query("COMMIT");
    return { database: me.db, applied: true, counts: list, totals, rehashed, rehashedFrom: from };
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

/** The report as plain lines: counts per kind and per organisation, never a name. */
export function reportLines(r: CleanReport): string[] {
  const lines = [`${r.applied ? "APPLIED" : "DRY RUN (nothing changed)"} on database ${r.database}`];
  for (const k of KINDS) {
    lines.push(`  ${k.kind}: ${r.totals[k.kind]} row(s) ${k.kind.endsWith("label") ? "labelled unlike their file" : "holding a name or reason"}`);
    for (const row of r.counts.filter((x) => x.kind === k.kind))
      lines.push(`    org ${row.orgId ?? "(none)"} (${row.orgKind ?? "unknown"}): ${row.rows}`);
  }
  if (r.rehashedFrom !== null)
    lines.push(`  audit chain: ${r.rehashed} sealed entr(ies) ${r.applied ? "re-hashed" : "to re-hash"} from entry ${r.rehashedFrom}`);
  else if (r.applied && r.counts.length === 0) lines.push("  nothing to clean; nothing was changed");
  return lines;
}
