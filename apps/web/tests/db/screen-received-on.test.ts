// The midnight bug (page audit, batch 0): the date a client's answer to a
// recommendation was received is checked against the firm's day, not the
// database session's. The server runs in UTC, so from midnight to 03:00 in
// Riyadh its current_date is still yesterday, and an answer received "today"
// was refused as a future date.
//
// A test cannot move the clock, but current_date follows the session's
// TimeZone while app_firm_today() does not. So each check runs in a session
// set to a zone where the two days differ right now: UTC-12 is a day behind
// Riyadh until 15:00 Riyadh time, UTC+14 a day ahead from 13:00. At any hour
// at least one of them applies (both between 13:00 and 15:00).
//
// Run: TEST_DATABASE_OWNER_URL=... TEST_DATABASE_APP_URL=... npm run test:db
import type { PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { recordResponse } from "@/services/responses";
import { as, end, REC, seed, svc, U } from "./screen-bugs-fixture";

beforeAll(seed);
afterAll(end);

const BEHIND = "Etc/GMT+12"; // POSIX sign: UTC-12
const AHEAD = "Etc/GMT-14"; // UTC+14
const inZone = (tz: string) => (c: PoolClient) => c.query(`SET LOCAL TimeZone = '${tz}'`);

/** In a session set to `tz`: its current_date less the firm's day, and the firm's day (and the next). */
const days = (tz: string) =>
  as(U.wlead, async (c) => {
    await inZone(tz)(c);
    const { rows } = await c.query(`SELECT current_date - app_firm_today() AS gap, app_firm_today()::text AS today, (app_firm_today() + 1)::text AS tomorrow`);
    return rows[0] as { gap: number; today: string; tomorrow: string };
  });

const answer = (receivedOn: string, tz: string) =>
  svc(
    U.wlead,
    (tx, p) =>
      recordResponse(tx, p, REC.waha, {
        stance: "agree",
        plannedAction: "The family council adopts the charter",
        targetDate: "2099-12-31",
        receivedVia: "phone",
        receivedOn,
      }),
    { before: inZone(tz) },
  );

describe("the day a recorded answer was received (the midnight bug)", () => {
  it("takes the firm's today and refuses the firm's tomorrow", async () => {
    const { today, tomorrow } = await days("UTC");
    await expect(answer(today, "UTC")).resolves.toMatchObject({ id: expect.any(String) });
    await expect(answer(tomorrow, "UTC")).rejects.toThrow(/received_on cannot be in the future/);
  });

  it("goes by the firm's day when the database's day is different", async () => {
    let checked = 0;
    const behind = await days(BEHIND);
    if (behind.gap === -1) {
      // The database thinks it is still yesterday (Riyadh just after midnight, UTC server): today is not the future.
      await expect(answer(behind.today, BEHIND)).resolves.toMatchObject({ id: expect.any(String) });
      checked++;
    }
    const ahead = await days(AHEAD);
    if (ahead.gap === 1) {
      // The database's day is already the firm's tomorrow: that is still the future for the firm.
      await expect(answer(ahead.tomorrow, AHEAD)).rejects.toThrow(/received_on cannot be in the future/);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });
});
