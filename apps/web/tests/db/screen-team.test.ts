// The "Projects" number beside each person on /team (page audit N13): the
// projects the person is on that the reader may open too. The same rule for
// every reader, a lead counts the projects he leads, and nobody learns of a
// project they cannot see.
//
// Run: TEST_DATABASE_OWNER_URL=... TEST_DATABASE_APP_URL=... npm run test:db
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listTeam } from "@/services/queries";
import { end, seed, svc, U } from "./screen-bugs-fixture";

beforeAll(seed);
afterAll(end);

const counts = async (reader: string) =>
  Object.fromEntries((await svc(reader, (tx, p) => listTeam(tx, p))).map((m) => [m.id, m.projectCount]));

describe("projects beside each person on Team (N13)", () => {
  it("counts the projects a client's lead runs, for the lead himself", async () => {
    // Acme's lead is staffed on none of its two projects; he runs both.
    expect((await counts(U.lead))[U.lead]).toBe(2);
    // Waha's and Rawdah's lead is staffed on Waha's project and leads Rawdah's too.
    expect((await counts(U.wlead))[U.wlead]).toBe(2);
  });

  it("counts only what the reader can open, so readers can differ but never learn of a hidden project", async () => {
    const byCons = await counts(U.cons); // sees Acme's main project only
    expect(byCons[U.lead]).toBe(1);
    expect(byCons[U.cons]).toBe(1);
    expect(byCons[U.wlead]).toBe(0);
    const byOutsider = await counts(U.outsider); // sees Other's project only
    expect(byOutsider[U.lead]).toBe(0);
    expect(byOutsider[U.cons]).toBe(0);
    expect(byOutsider[U.outsider]).toBe(1);
  });

  it("counts a client's people on the projects they share with the reader", async () => {
    const byManager = await counts(U.cmgr);
    expect(byManager[U.cowner]).toBe(1);
    expect(byManager[U.cmgr]).toBe(1);
  });
});
