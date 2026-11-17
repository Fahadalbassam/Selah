// The reminder ladder on the action page (page audit B3): drawn for an open
// action only, never for a verified, closed or draft one.
//
// Run: TEST_DATABASE_OWNER_URL=... TEST_DATABASE_APP_URL=... npm run test:db
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { actionLadder } from "@/services/follow-through";
import { action, end, owner, seed, svc, U } from "./screen-bugs-fixture";

beforeAll(seed);
afterAll(end);

const inDays = async (days: number) => (await owner.query(`SELECT (app_firm_today() + $1::int)::text AS d`, [days])).rows[0].d as string;

describe("the reminder ladder on finished and draft actions (B3)", () => {
  it("lists its four steps on an open action, as before", async () => {
    const open = await action({ due: await inDays(20) });
    for (const reader of [U.cons, U.cowner]) {
      const ladder = await svc(reader, (tx, p) => actionLadder(tx, p, open));
      expect(ladder.running).toBe(true);
      expect(ladder.steps.map((s) => s.level)).toEqual([0, 1, 2, 3]);
    }
  });

  it("has no steps on a verified, closed or draft action, so the card is not drawn", async () => {
    const due = await inDays(-20); // one step dated in the future, the rest past: what the audit saw
    const verified = await action({ due, status: "verified_complete" });
    const closed = await action({ due, status: "closed", closure: "risk_accepted" });
    const draft = await action({ due, status: "draft" });
    for (const aid of [verified, closed, draft]) {
      expect(await svc(U.cons, (tx, p) => actionLadder(tx, p, aid))).toEqual({ running: false, steps: [] });
    }
    for (const aid of [verified, closed]) {
      expect(await svc(U.cowner, (tx, p) => actionLadder(tx, p, aid))).toEqual({ running: false, steps: [] });
    }
  });

  it("still pauses, with its dates, while an open action waits on the firm", async () => {
    const waiting = await action({ due: await inDays(20), status: "awaiting_review" });
    const ladder = await svc(U.cowner, (tx, p) => actionLadder(tx, p, waiting));
    expect(ladder.running).toBe(false);
    expect(ladder.steps).toHaveLength(4);
  });
});
