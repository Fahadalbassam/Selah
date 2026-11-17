// A client the firm runs (page audit N24): its project and action pages know
// it, so they say the firm records the work for the client, and the history
// says how and when the client sent each recorded piece. The note and file
// dialogs send that with what the consultant records; the server refuses a
// recording without it, which is what the screens sent before.
//
// Run: TEST_DATABASE_OWNER_URL=... TEST_DATABASE_APP_URL=... npm run test:db
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { firmRun, panelVoice, receivedPayload } from "@/lib/engagement";
import { submitEvidence } from "@/services/evidence";
import { addProgressUpdate } from "@/services/progress";
import { getActionDetail, getProject } from "@/services/queries";
import { action, end, owner, P, REC, seed, svc, U, WAHA } from "./screen-bugs-fixture";

vi.mock("@/services/storage", () => ({ putObject: async () => undefined, copyObject: async () => undefined }));

beforeAll(seed);
afterAll(end);

const firmDay = async (plus = 0) => (await owner.query(`SELECT (app_firm_today() + $1::int)::text AS d`, [plus])).rows[0].d as string;
const file = { bytes: new Uint8Array([37, 80, 68, 70]), fileName: "charter.pdf", contentType: "application/pdf", sha256: "x", scanned: true, scanMs: 1 };

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

describe("recording for a client the firm runs, as the action page sends it", () => {
  const wahaAction = () => action({ project: P.waha, org: WAHA, rec: REC.waha, owner: null, ownerName: "Office manager" });

  it("takes a progress note with how and when the client sent it, and refuses one without", async () => {
    const aid = await wahaAction();
    // What the form sent before: nothing about how or when.
    await expect(svc(U.wlead, (tx, p) => addProgressUpdate(tx, p, aid, "Agreed by phone.", receivedPayload(false, "phone", undefined)))).rejects.toThrow(
      /say how and when the client told you/,
    );
    // What it sends now, the day defaulting to the firm's today.
    const on = await firmDay();
    await svc(U.wlead, (tx, p) => addProgressUpdate(tx, p, aid, "Agreed by phone.", receivedPayload(true, "phone", on)), { commit: true });
    const { timeline } = await svc(U.wlead, (tx, p) => getActionDetail(tx, p, aid));
    expect(timeline.find((e) => e.kind === "update")).toMatchObject({ source: "consultant_recorded", receivedVia: "phone", receivedOn: on });
  });

  it("answers an evidence-list item with a file the client sent, through the item's own Send a file", async () => {
    const aid = await wahaAction();
    const { rows } = await owner.query(
      `INSERT INTO evidence_requests (project_id, org_id, action_id, title, created_by) VALUES ($1,$2,$3,'Signed charter',$4) RETURNING id`,
      [P.waha, WAHA, aid, U.wlead],
    );
    const item = rows[0].id as string;
    const answer = (received: ReturnType<typeof receivedPayload>) =>
      svc(U.wlead, (tx, p) => submitEvidence(tx, p, aid, { file, submitForReview: false, evidenceRequestId: item, received }), { commit: true });
    await expect(answer(receivedPayload(true, "", undefined))).rejects.toThrow(/say how and when the client told you/);
    await expect(answer(receivedPayload(true, "email", await firmDay(1)))).rejects.toThrow(/received_on cannot be in the future/);
    await answer(receivedPayload(true, "email", await firmDay()));
    expect((await owner.query(`SELECT status FROM evidence_requests WHERE id = $1`, [item])).rows[0].status).toBe("submitted");
    expect((await owner.query(`SELECT source, received_via FROM evidence_submissions WHERE evidence_request_id = $1`, [item])).rows).toEqual([
      { source: "consultant_recorded", received_via: "email" },
    ]);
  });
});
