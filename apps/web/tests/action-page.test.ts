// The action page (page audit 4.5, batch 4): one page for owner, manager and
// reviewer, one main action at a time. nextStep() (lib/action-next.ts) turns
// what the server allows this reader into the one card: its single solid
// button, the outline beside it, the waiting line, the three quiet links and
// the page menu. It never offers a step the server did not allow.
//
// And one way to send a file (U05): every place in the app that takes a file
// uses the one dialog (components/send-file-dialog.tsx).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import type { ActionStatus } from "@/authz/workflow";
import { nextStep, type NextInput } from "@/lib/action-next";

const base = (over: Partial<NextInput>): NextInput => ({
  status: "in_progress",
  moves: [],
  canSubmitEvidence: false,
  canRequestDate: false,
  canAsk: false,
  canSignRisk: false,
  canMute: false,
  second: null,
  dateToDecide: false,
  items: { open: 0, submitted: 0 },
  ...over,
});
// What the server allows an owner (or a client manager on someone's action) in each state.
const OWNER_MOVES: Partial<Record<ActionStatus, ActionStatus[]>> = {
  assigned: ["in_progress"],
  in_progress: ["blocked", "awaiting_review"],
  blocked: ["in_progress"],
  revision_requested: ["in_progress"],
};
const owner = (status: ActionStatus, over: Partial<NextInput> = {}) =>
  nextStep(
    base({
      status,
      moves: OWNER_MOVES[status] ?? [],
      canSubmitEvidence: status === "in_progress" || status === "revision_requested",
      canRequestDate: status !== "verified_complete" && status !== "closed",
      canAsk: true,
      canMute: true,
      ...over,
    }),
  );
// The firm reviewer: closing and reopening in every state, the review while it waits.
const reviewer = (status: ActionStatus, over: Partial<NextInput> = {}) =>
  nextStep(
    base({
      status,
      moves: [
        ...(status === "awaiting_review" ? (["verified_complete", "revision_requested"] as const) : []),
        ...(status === "draft" ? (["assigned"] as const) : []),
        ...(["assigned", "in_progress", "blocked", "awaiting_review", "revision_requested"].includes(status) ? (["closed"] as const) : []),
        ...(status === "verified_complete" || status === "closed" ? (["in_progress"] as const) : []),
      ],
      firm: true,
      canMute: true,
      ...over,
    }),
  );

describe("the owner's or manager's next step (page audit 4.5, block 3)", () => {
  it("one solid step per state, in the table's words", () => {
    expect(owner("assigned").main).toBe("start");
    expect(owner("in_progress").main).toBe("send");
    // Sent back: one step sends the revised file for review (no "Resume work" first).
    expect(owner("revision_requested").main).toBe("resend");
    expect(owner("blocked").main).toBe("resume");
    expect(owner("awaiting_review").main).toBeNull();
    expect(owner("awaiting_review").waiting).toBe("withConsultant");
    expect(owner("verified_complete").card).toBe(false);
    expect(owner("closed").card).toBe(false);
  });

  it("says when a second consultant checks it, never the count", () => {
    const view = owner("awaiting_review", { second: { required: true, signed: true, canSignOff: false, canVerify: false } });
    expect(view.waiting).toBe("withConsultant");
    expect(view.secondChecks).toBe(true);
  });

  it("'I am stuck', 'I need more time' and 'Ask the consultant' are quiet links under the button, not buttons", () => {
    expect(owner("in_progress").links).toEqual(["stuck", "moreTime", "ask"]);
    // Blocking is a move of work in progress only: no "stuck" link where the server would refuse it.
    expect(owner("assigned").links).toEqual(["moreTime", "ask"]);
    expect(owner("in_progress").outline).toEqual([]);
  });

  it("offers nothing the server did not allow", () => {
    const nothing = nextStep(base({ status: "in_progress" }));
    expect(nothing.main).toBeNull();
    expect(nothing.links).toEqual([]);
    expect(nothing.menu).toEqual([]);
    expect(nextStep(base({ status: "assigned" })).main).toBeNull();
  });

  it("a client reader with nothing to do on someone else's action reads who it is with", () => {
    expect(nextStep(base({ status: "in_progress" })).waiting).toBe("withOwner");
  });

  it("the rare things go in the page menu", () => {
    expect(owner("in_progress", { canSignRisk: true }).menu).toEqual(["acceptRisk", "mute"]);
  });
});

describe("the reviewer's next step", () => {
  it("while the client works: 'With the client', and no button", () => {
    for (const s of ["assigned", "in_progress", "revision_requested", "blocked"] as const) {
      expect(reviewer(s).main, s).toBeNull();
      expect(reviewer(s).waiting, s).toBe("withClient");
    }
  });

  it("awaiting review: Verify solid, Send back outline", () => {
    const view = reviewer("awaiting_review");
    expect(view.main).toBe("verify");
    expect(view.outline).toEqual(["sendBack"]);
  });

  it("two sign-offs: the first sign-off, then the second, in the same place", () => {
    expect(reviewer("awaiting_review", { second: { required: true, signed: false, canSignOff: true, canVerify: false } }).main).toBe("signOff");
    expect(reviewer("awaiting_review", { second: { required: true, signed: true, canSignOff: false, canVerify: true } }).main).toBe("secondSignOff");
    // The one who signed first waits for someone else.
    const first = reviewer("awaiting_review", { moves: ["closed"], second: { required: true, signed: true, canSignOff: false, canVerify: false } });
    expect(first.main).toBeNull();
    expect(first.waiting).toBe("otherReviewer");
  });

  it("a reviewer who sent the work themselves (separation of duties) is told someone else reviews it", () => {
    const view = reviewer("awaiting_review", { moves: ["closed"] });
    expect(view.main).toBeNull();
    expect(view.waiting).toBe("otherReviewer");
  });

  it("a date request to decide is the main step when there is no review to do", () => {
    const view = reviewer("in_progress", { dateToDecide: true });
    expect(view.main).toBe("approveDate");
    expect(view.outline).toEqual(["declineDate"]);
  });

  it("close and reopen are in the menu, never a button", () => {
    expect(reviewer("in_progress").menu).toEqual(["close", "mute"]);
    expect(reviewer("verified_complete").menu).toEqual(["reopen", "mute"]);
    expect(reviewer("verified_complete").card).toBe(false);
  });

  it("a draft: Release to owner", () => {
    expect(reviewer("draft").main).toBe("release");
  });

  it("October item 12: verifying accepts the last files still to check, only when that changes nobody's role", () => {
    // Every item already has its file, none is still open: one step.
    expect(reviewer("awaiting_review", { items: { open: 0, submitted: 1 } }).acceptsItems).toBe(true);
    // An item with nothing sent yet cannot be accepted: verify waits.
    expect(reviewer("awaiting_review", { items: { open: 1, submitted: 1 } }).acceptsItems).toBe(false);
    expect(reviewer("awaiting_review", { items: { open: 1, submitted: 1 } }).main).toBe("verify");
    // Two sign-offs: never merged (the first reviewer's acceptance of the items would be skipped).
    expect(
      reviewer("awaiting_review", { items: { open: 0, submitted: 1 }, second: { required: true, signed: true, canSignOff: false, canVerify: true } }).acceptsItems,
    ).toBe(false);
  });
});

describe("one way to send a file (U05)", () => {
  const src = join(__dirname, "..", "src");
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? files(p) : /\.tsx$/.test(f) ? [p] : [];
    });
  // The three imports read a workbook or a transcript, not a file sent to someone (page audit: "plus 3 imports").
  const IMPORTS = [
    "app/(app)/projects/[id]/import/import-wizard.tsx",
    "app/(app)/indicators/import/import-wizard.tsx",
    "app/(app)/meetings/[id]/transcript-panel.tsx",
  ];
  it("only the one dialog has a file field", () => {
    const withField = files(src)
      .filter((p) => /type="file"/.test(readFileSync(p, "utf8")))
      .map((p) => relative(src, p).replaceAll("\\", "/"))
      .filter((p) => !IMPORTS.includes(p));
    expect(withField).toEqual(["components/send-file-dialog.tsx"]);
  });

  it("every place that sends a file opens it", () => {
    for (const p of [
      "app/(app)/actions/[id]/send-file.tsx",
      "app/(app)/projects/[id]/info-requests-tab.tsx",
      "components/file-explorer.tsx",
      "components/file-actions.tsx",
      "app/(public)/upload/[token]/upload-form.tsx",
    ]) {
      expect(readFileSync(join(src, p), "utf8"), p).toMatch(/from "@\/components\/send-file-dialog"/);
    }
  });

  it("the action page has no separate 'Attach evidence' button and one conversation box", () => {
    const panel = readFileSync(join(src, "app/(app)/actions/[id]/action-panel.tsx"), "utf8");
    expect(panel).not.toMatch(/uploadOnly/);
    expect(panel).not.toMatch(/UpdateForm/);
  });
});
