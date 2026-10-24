// The alert job's owner-side checks (R4) against a real Postgres: mail that
// keeps failing, the audit chain's nightly check and its sealing.
//
// Run: TEST_DATABASE_OWNER_URL=... npm run test:db
import { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ownerChecks } from "../../src/jobs/ops-check";
import type { Check } from "../../src/lib/ops";
import { truncateAuditLog } from "./audit-reset";

const ownerUrl = process.env.TEST_DATABASE_OWNER_URL;
if (!ownerUrl) throw new Error("set TEST_DATABASE_OWNER_URL");
const owner = new Pool({ connectionString: ownerUrl, max: 2 });

const byName = async () =>
  Object.fromEntries(
    (await ownerChecks(owner)).map((c) => [c.name, c]),
  ) as Record<string, Check>;
const recordCheck = (ok: boolean, hoursAgo: number) =>
  owner.query(
    `INSERT INTO audit_chain_checks (checked_at, rows_checked, ok, head_seq, head_hash, unsealed)
     VALUES (now() - make_interval(hours => $1), 0, $2, 0, repeat('0', 64), 0)`,
    [hoursAgo, ok],
  );

beforeEach(async () => {
  await truncateAuditLog(owner);
  await owner.query(`DELETE FROM outbound_emails`);
});
afterAll(() => owner.end());

describe("owner-side checks", () => {
  it("pass on a quiet install whose chain was checked last night", async () => {
    await recordCheck(true, 5);
    const c = await byName();
    expect(Object.values(c).every((x) => x.ok && !x.critical)).toBe(true);
    expect(Object.keys(c).sort()).toEqual([
      "audit chain",
      "audit sealing",
      "mail",
    ]);
  });

  it("fail when the chain was never checked, was checked too long ago, or the last check failed", async () => {
    expect((await byName())["audit chain"]).toMatchObject({
      ok: false,
      error: "never checked",
    });
    await recordCheck(true, 40);
    expect((await byName())["audit chain"]).toMatchObject({
      ok: false,
      error: "not checked for 40 hours",
    });
    await recordCheck(false, 1);
    expect((await byName())["audit chain"]).toMatchObject({
      ok: false,
      error: "the last nightly check found the chain broken",
    });
  });

  it("fail when entries have waited over an hour to be sealed", async () => {
    await recordCheck(true, 1);
    await owner.query(
      `INSERT INTO audit_log (action, outcome) VALUES ('test.fresh', 'allow')`,
    );
    expect((await byName())["audit sealing"]!.ok).toBe(true);
    await owner.query(
      `INSERT INTO audit_log (action, outcome, created_at) VALUES ('test.old', 'allow', now() - interval '2 hours')`,
    );
    expect((await byName())["audit sealing"]).toMatchObject({
      ok: false,
      error: "1 entries unsealed for over 60 minutes",
    });
    await owner.query(`SELECT app_seal_audit_log()`);
    expect((await byName())["audit sealing"]!.ok).toBe(true);
  });

  it("fail when mail keeps failing to send or was given up on today, not while it waits its turn", async () => {
    await recordCheck(true, 1);
    await owner.query(
      `INSERT INTO outbound_emails (to_email, kind, created_at) VALUES ('a@x.test', 'invitation', now() - interval '3 hours')`,
    );
    expect((await byName()).mail!.ok).toBe(true);
    await owner.query(
      `INSERT INTO outbound_emails (to_email, kind, created_at, attempts, last_error) VALUES ('b@x.test', 'invitation', now() - interval '1 hour', 2, 'relay refused')`,
    );
    expect((await byName()).mail).toMatchObject({
      ok: false,
      error: "1 mails failing to send for over 30 minutes",
    });
    await owner.query(
      `UPDATE outbound_emails SET failed_at = now() WHERE to_email = 'b@x.test'`,
    );
    expect((await byName()).mail).toMatchObject({
      ok: false,
      error: "1 mails given up on in the last day",
    });
  });
});
