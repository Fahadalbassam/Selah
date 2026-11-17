// A client the firm runs (page audit N24): its project and action pages know
// it, so they say the firm records the work for the client, and the history
// says how and when the client sent each recorded piece.
//
// Run: TEST_DATABASE_OWNER_URL=... TEST_DATABASE_APP_URL=... npm run test:db
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { firmRun, panelVoice } from "@/lib/engagement";
import { addProgressUpdate } from "@/services/progress";
import { getActionDetail, getProject } from "@/services/queries";
import { action, end, owner, P, REC, seed, svc, U, WAHA } from "./screen-bugs-fixture";

beforeAll(seed);
afterAll(end);

describe("pages on a client the firm runs (N24)", () => {
  it("know the client is run by the firm, on the project and on the action", async () => {
    const project = (await svc(U.wlead, (tx, p) => getProject(tx, p, P.waha))).project;
    expect(firmRun(project.kind, project.engagementMode)).toBe(true);
    const aid = await action({ project: P.waha, org: WAHA, rec: REC.waha, owner: null, ownerName: "Office manager" });
    const { context } = await svc(U.wlead, (tx, p) => getActionDetail(tx, p, aid));
    expect(firmRun(context.projectKind, context.engagementMode)).toBe(true);
    expect(panelVoice(true, firmRun(context.projectKind, context.engagementMode))).toBe("FirmRun");
  });

  it("do not on a client whose people sign in", async () => {
    const project = (await svc(U.cons, (tx, p) => getProject(tx, p, P.acme))).project;
    expect(firmRun(project.kind, project.engagementMode)).toBe(false);
    const aid = await action({});
    const { context } = await svc(U.cons, (tx, p) => getActionDetail(tx, p, aid));
    expect(panelVoice(true, firmRun(context.projectKind, context.engagementMode))).toBe("Firm");
  });

  it("give the history how and when the client sent what the firm recorded", async () => {
    const aid = await action({ project: P.waha, org: WAHA, rec: REC.waha, owner: null, ownerName: "Office manager" });
    const today = (await owner.query(`SELECT app_firm_today()::text AS d`)).rows[0].d as string;
    await svc(U.wlead, (tx, p) => addProgressUpdate(tx, p, aid, "The draft reached the family council.", { receivedVia: "email", receivedOn: today }), { commit: true });
    const { timeline } = await svc(U.wlead, (tx, p) => getActionDetail(tx, p, aid));
    expect(timeline.find((e) => e.kind === "update")).toMatchObject({ source: "consultant_recorded", receivedVia: "email", receivedOn: today });
  });
});
