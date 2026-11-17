// Small faults on screen (page audit section 3.8) that depend on the data:
// the pitch on Projects, the data-sharing question on a client's home, and
// the "Available to assistant" badge on a project's files.
//
// Run: TEST_DATABASE_OWNER_URL=... TEST_DATABASE_APP_URL=... npm run test:db
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dataSetupStep } from "@/services/indicator-data";
import { listProjects } from "@/services/queries";
import { ACME, end, owner, P, RAWDAH, seed, svc, U } from "./screen-bugs-fixture";

beforeAll(seed);
afterAll(end);

describe("a pitch on Projects", () => {
  it("is marked as a pitch, not as a plain client project", async () => {
    const rows = await svc(U.admin, (tx, p) => listProjects(tx, p));
    expect(rows.find((r) => r.id === P.pitch)).toMatchObject({ kind: "client", pitch: true });
    expect(rows.find((r) => r.id === P.acme)).toMatchObject({ kind: "client", pitch: false });
    expect(rows.find((r) => r.id === P.rawdah)).toMatchObject({ pitch: false });
  });
});

describe("how the client's figures reach Selah, on the client admin's home", () => {
  it("is asked of a client with a project still to run", async () => {
    expect(await svc(U.cadmin, (tx, p) => dataSetupStep(tx, p, ACME))).toMatchObject({ clientId: ACME });
  });

  it("is not asked of a client with no indicators whose only project is closing", async () => {
    expect(await svc(U.radmin, (tx, p) => dataSetupStep(tx, p, RAWDAH))).toBeNull();
  });

  it("is asked again once that client has an indicator", async () => {
    await owner.query(
      `INSERT INTO client_kpis (org_id, name_en, unit, direction, baseline, baseline_period, created_by)
       VALUES ($1, 'Donors kept', '%', 'higher_better', 60, date_trunc('month', app_firm_today())::date, $2)`,
      [RAWDAH, U.radmin],
    );
    expect(await svc(U.radmin, (tx, p) => dataSetupStep(tx, p, RAWDAH))).toMatchObject({ clientId: RAWDAH });
  });
});
