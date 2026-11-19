// Batch 5 (U16): the inquiry page as numbered steps, one current step,
// closing as a quiet link. A wording batch changes no product rule (the
// lead's decision on review S3): the steps offer exactly what the server
// allows, as the page did before; the conflict check is a fact on the side,
// not a step that gates the others.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { INQUIRY_STEPS, inquirySteps, type InquiryFacts } from "@/lib/inquiry-steps";
import ar from "../messages/ar.json";
import en from "../messages/en.json";

const ADMIN = { work: true, decide: true, forward: null, convert: false };
const OWNER = { work: true, decide: false, forward: null, convert: false };
const facts = (over: Partial<InquiryFacts> = {}): InquiryFacts => ({
  status: "new",
  hasOwner: false,
  sessionBooked: false,
  converted: false,
  ...over,
  can: { ...ADMIN, ...over.can },
});
const states = (f: InquiryFacts) => inquirySteps(f).steps.map((s) => s.state);

describe("the steps", () => {
  it("are four, in order; the conflict check is not one of them", () => {
    expect(INQUIRY_STEPS).toEqual(["triage", "discovery", "proposal", "decide"]);
  });

  it("a new inquiry: step 1 is current, and the admin's button gives it an owner", () => {
    const v = inquirySteps(facts({ can: { ...ADMIN, forward: "triaged" } }));
    expect(v.current).toBe("triage");
    expect(v.main).toBe("assign");
    expect(states(facts())).toEqual(["current", "todo", "todo", "todo"]);
  });

  it("with an owner, the owner marks it read, and may book the session at once, as the server allows (review S3)", () => {
    const v = inquirySteps(facts({ hasOwner: true, can: { ...OWNER, forward: "triaged" } }));
    expect(v.main).toBe("triage");
    expect(v.also).toEqual(["bookDiscovery"]);
  });

  it("once read, the owner books the session; no conflict check stands in the way", () => {
    const v = inquirySteps(facts({ status: "triaged", hasOwner: true, can: { ...OWNER, forward: "discovery_scheduled" } }));
    expect(v.current).toBe("discovery");
    expect(v.main).toBe("bookDiscovery");
  });

  it("exactly one step is current while the inquiry is open", () => {
    for (const status of ["new", "triaged", "discovery_scheduled", "discovery_done", "proposal_sent"]) {
      expect(inquirySteps(facts({ status })).steps.filter((s) => s.state === "current").length, status).toBe(1);
    }
  });

  it("a booked session is recorded, not booked again (review L04)", () => {
    const base = facts({ status: "discovery_scheduled" });
    expect(inquirySteps(base).main).toBe("bookDiscovery");
    expect(inquirySteps({ ...base, sessionBooked: true }).main).toBe("recordDiscovery");
    expect(inquirySteps({ ...base, sessionBooked: true }).also).toEqual([]);
  });

  it("after the session: the owner sends the proposal; the admin may also make it a client when the server allows", () => {
    const owner = inquirySteps(facts({ status: "discovery_done", can: { ...OWNER, forward: "proposal_sent" } }));
    expect(owner.current).toBe("proposal");
    expect(owner.main).toBe("proposalSent");
    expect(owner.also).toEqual([]);
    const admin = inquirySteps(facts({ status: "discovery_done", can: { ...ADMIN, forward: "proposal_sent", convert: true } }));
    expect(admin.also).toEqual(["convert"]);
    const sent = inquirySteps(facts({ status: "proposal_sent", can: { ...ADMIN, convert: true } }));
    expect(sent.current).toBe("decide");
    expect(sent.main).toBe("convert");
  });

  it("offers nothing the reader may not do: moving forward needs inquiry.work (review N2)", () => {
    const reader = { work: false, decide: false, forward: "triaged", convert: false };
    const v = inquirySteps(facts({ hasOwner: true, can: reader }));
    expect(v.main).toBeNull();
    expect(v.also).toEqual([]);
    expect(inquirySteps(facts({ status: "discovery_done", can: { ...reader, forward: "proposal_sent" } })).main).toBeNull();
  });

  it("won: every step done, none current; closed: none current and no button", () => {
    expect(states(facts({ status: "won", converted: true }))).toEqual(["done", "done", "done", "done"]);
    const lost = inquirySteps(facts({ status: "lost" }));
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
    expect(page.slice(at - 120, at)).toMatch(/variant="ghost"|variant="link"/);
  });

  it("the conflict check is a fact on the side with its own buttons, whatever the current step", () => {
    expect(page).not.toContain('view.main !== "runSearch"');
    expect(page).toContain("conflict-search");
  });

  it("the side cards are facts with an edit, not another next step", () => {
    expect(page).not.toContain('t("nextStep")');
  });
});

describe.each([
  ["ar", ar],
  ["en", en],
])("%s step words", (_, m) => {
  const steps = (m as unknown as { inbox: { steps: Record<string, Record<string, string>> } }).inbox.steps;
  it("each step has its title and hint, and no step is left over", () => {
    for (const k of INQUIRY_STEPS) {
      expect(typeof steps[k]?.title, k).toBe("string");
      expect(typeof steps[k]?.hint, k).toBe("string");
    }
    expect(Object.keys(steps).sort()).toEqual([...INQUIRY_STEPS].sort());
  });
});
