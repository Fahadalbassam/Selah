// Batch 5 (U16): the inquiry page as numbered steps, one current step with
// one button, closing as a quiet link. Checked on the shared step module and
// on the page's source.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { INQUIRY_STEPS, inquirySteps, type InquiryFacts } from "@/lib/inquiry-steps";
import ar from "../messages/ar.json";
import en from "../messages/en.json";

const ADMIN = { work: true, decide: true, forward: null, convert: false };
const facts = (over: Partial<InquiryFacts> = {}): InquiryFacts => ({
  status: "new",
  hasOwner: false,
  conflictStatus: "not_checked",
  searched: false,
  sessionBooked: false,
  converted: false,
  ...over,
  can: { ...ADMIN, ...over.can },
});
const states = (f: InquiryFacts) => inquirySteps(f).steps.map((s) => s.state);

describe("the steps", () => {
  it("are five, in the order the Inquiries list names them", () => {
    expect(INQUIRY_STEPS).toEqual(["triage", "conflict", "discovery", "proposal", "decide"]);
  });

  it("a new inquiry: step 1 is current, and the admin's button gives it an owner", () => {
    const v = inquirySteps(facts({ can: { ...ADMIN, forward: "triaged" } }));
    expect(v.current).toBe("triage");
    expect(v.main).toBe("assign");
    expect(states(facts())).toEqual(["current", "todo", "todo", "todo", "todo"]);
  });

  it("with an owner, the owner marks it read", () => {
    const v = inquirySteps(facts({ hasOwner: true, can: { work: true, decide: false, forward: "triaged", convert: false } }));
    expect(v.main).toBe("triage");
  });

  it("exactly one step is current while the inquiry is open", () => {
    for (const status of ["new", "triaged", "discovery_scheduled", "discovery_done", "proposal_sent"]) {
      for (const conflictStatus of ["not_checked", "clear", "flagged", "waived"] as const) {
        const v = inquirySteps(facts({ status, conflictStatus }));
        expect(v.steps.filter((s) => s.state === "current").length + (v.steps.some((s) => s.state === "problem" && s.key === v.current) ? 1 : 0), `${status} ${conflictStatus}`).toBe(1);
      }
    }
  });

  it("the conflict check comes before the session; only the firm admin has its button", () => {
    const triaged = facts({ status: "triaged", hasOwner: true });
    expect(inquirySteps(triaged).current).toBe("conflict");
    expect(inquirySteps(triaged).main).toBe("runSearch");
    expect(inquirySteps({ ...triaged, searched: true }).main).toBe("recordConflict");
    expect(inquirySteps({ ...triaged, can: { work: true, decide: false, forward: "discovery_scheduled", convert: false } }).main).toBeNull();
  });

  it("a flagged check is drawn as a problem, and stays the current step", () => {
    const v = inquirySteps(facts({ status: "triaged", conflictStatus: "flagged" }));
    expect(v.current).toBe("conflict");
    expect(v.steps[1]!.state).toBe("problem");
  });

  it("a booked session is recorded, not booked again (review L04)", () => {
    const base = facts({ status: "discovery_scheduled", conflictStatus: "clear" });
    expect(inquirySteps(base).main).toBe("bookDiscovery");
    expect(inquirySteps({ ...base, sessionBooked: true }).main).toBe("recordDiscovery");
  });

  it("after the session: the proposal, with 'make it a client' as a quiet second way for the admin", () => {
    const v = inquirySteps(facts({ status: "discovery_done", conflictStatus: "clear", can: { ...ADMIN, forward: "proposal_sent", convert: true } }));
    expect(v.current).toBe("proposal");
    expect(v.main).toBe("proposalSent");
    expect(v.alsoConvert).toBe(true);
    const sent = inquirySteps(facts({ status: "proposal_sent", conflictStatus: "waived", can: { ...ADMIN, convert: true } }));
    expect(sent.current).toBe("decide");
    expect(sent.main).toBe("convert");
  });

  it("won: every step done, none current; closed: none current and no button", () => {
    expect(states(facts({ status: "won", converted: true }))).toEqual(["done", "done", "done", "done", "done"]);
    const lost = inquirySteps(facts({ status: "lost", conflictStatus: "clear" }));
    expect(lost.current).toBeNull();
    expect(lost.main).toBeNull();
    expect(lost.closed).toBe(true);
  });
});

describe("the page", () => {
  const page = readFileSync(join(__dirname, "../src/app/(app)/inquiries/[id]/page.tsx"), "utf8");

  it("draws the steps as one numbered list from inquirySteps()", () => {
    expect(page).toContain("inquirySteps(");
    expect(page).toMatch(/<ol[^>]*>/);
  });

  it("closing is a quiet link, never a solid button", () => {
    const at = page.indexOf("closeInquiry");
    expect(at).toBeGreaterThan(0);
    const close = page.slice(at - 120, at);
    expect(close).toMatch(/variant="ghost"|variant="link"/);
  });

  it("the side cards are facts with an edit, not another next step", () => {
    expect(page).not.toContain('t("nextStep")');
    expect(page).not.toMatch(/<ConvertDialog[^>]*\/>\s*<\/CardContent>/);
  });
});

describe.each([
  ["ar", ar],
  ["en", en],
])("%s step words", (_, m) => {
  const steps = (m as unknown as { inbox: { steps: Record<string, Record<string, string>> } }).inbox.steps;
  it("each step has its title and hint", () => {
    for (const k of INQUIRY_STEPS) {
      expect(typeof steps[k]?.title, k).toBe("string");
      expect(typeof steps[k]?.hint, k).toBe("string");
    }
  });
});
