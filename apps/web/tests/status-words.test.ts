// Decision D3: six visible status words on every list and badge, by the
// placement table (docs/placement.md); the exact state stays on the detail
// page. Every stored state of every kind of thing falls under exactly one of
// the six, and each word has one Arabic and one English label.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  actionStatus,
  closureRequestStatus,
  evidenceRequestStatus,
  infoRequestStatus,
  inquiryStatus,
  meetingStatus,
  projectState,
  requestStatus,
} from "@/db/schema";
import {
  ACTION_STATES,
  PLACEMENTS,
  STATUS_WORDS,
  actionExactShown,
  actionPlacement,
  evidenceItemPlacement,
  infoRequestPlacement,
  inquiryPlacement,
  labelKey,
  meetingPlacement,
  placementTone,
  projectPlacement,
  wordKey,
  type Placement,
} from "@/lib/status-words";
import ar from "../messages/ar.json";
import en from "../messages/en.json";

const STORED = {
  action: actionStatus.enumValues,
  evidenceItem: evidenceRequestStatus.enumValues,
  infoRequest: infoRequestStatus.enumValues,
  dateRequest: requestStatus.enumValues,
  inquiry: inquiryStatus.enumValues,
  project: projectState.enumValues,
  closeRequest: closureRequestStatus.enumValues,
} as const;

describe("every stored state has exactly one of the six words", () => {
  it.each(Object.keys(STORED) as (keyof typeof STORED)[])("%s", (kind) => {
    const table = PLACEMENTS[kind] as Record<string, Placement>;
    expect(Object.keys(table).sort()).toEqual([...STORED[kind]].sort());
    for (const s of STORED[kind]) {
      expect(STATUS_WORDS).toContain(table[s]!.word);
      // "waiting" always says on whom; the other words never do.
      expect(table[s]!.word === "waiting").toBe(table[s]!.on !== undefined);
    }
  });

  it("meetings: unanswered waits for the reader, answered has not started, held and cancelled are closed", () => {
    for (const s of meetingStatus.enumValues) for (const u of [true, false]) expect(STATUS_WORDS).toContain(meetingPlacement(s, u).word);
    expect(wordKey(meetingPlacement("scheduled", true), "firm")).toBe("waitingYou");
    expect(wordKey(meetingPlacement("scheduled", false), "client")).toBe("notStarted");
    expect(labelKey(meetingPlacement("held"), "client")).toBe("items.held");
    expect(meetingPlacement("cancelled").word).toBe("closed");
  });

  it("is exactly the six of D3", () => {
    expect(STATUS_WORDS).toEqual(["not_started", "in_progress", "waiting", "needs_attention", "verified", "closed"]);
  });
});

describe("actions, by the placement table", () => {
  const firm = (s: (typeof ACTION_STATES)[number]) => wordKey(actionPlacement(s), "firm");
  const client = (s: (typeof ACTION_STATES)[number]) => wordKey(actionPlacement(s), "client");

  it("draft and assigned have not started; blocked needs attention", () => {
    expect(firm("draft")).toBe("notStarted");
    expect(client("assigned")).toBe("notStarted");
    expect(firm("blocked")).toBe("needsAttention");
    expect(client("blocked")).toBe("needsAttention");
  });

  it("awaiting review waits for the firm, on both sides", () => {
    expect(firm("awaiting_review")).toBe("waitingFirm");
    expect(client("awaiting_review")).toBe("waitingFirm");
  });

  it("sent back waits for the client; the client reads 'for you'", () => {
    expect(firm("revision_requested")).toBe("waitingClient");
    expect(client("revision_requested")).toBe("waitingYou");
  });

  it("verified and closed stay apart", () => {
    expect(firm("verified_complete")).toBe("verified");
    expect(firm("closed")).toBe("closed");
  });

  it("only a verified action is green", () => {
    const green = Object.values(PLACEMENTS).flatMap((t) => Object.entries(t as Record<string, Placement>).filter(([, p]) => placementTone(p) === "verified"));
    expect(green.map(([s]) => s)).toEqual(["verified_complete"]);
  });

  it("the detail page shows the exact state only where the word does not say it", () => {
    expect(ACTION_STATES.filter(actionExactShown)).toEqual(["draft", "assigned", "blocked", "awaiting_review", "revision_requested"]);
  });
});

describe("the parts: one 'yes' verb per level", () => {
  it("an accepted evidence item or document request is 'Accepted', never 'Verified'", () => {
    expect(labelKey(evidenceItemPlacement("accepted"), "firm")).toBe("items.accepted");
    expect(labelKey(infoRequestPlacement("reviewed"), "client")).toBe("items.accepted");
    expect(labelKey(evidenceItemPlacement("waived"), "client")).toBe("items.notNeeded");
    expect(labelKey(infoRequestPlacement("not_applicable"), "client")).toBe("items.notApplicable");
  });

  it("an open item waits for the side asked; a sent one for the firm", () => {
    expect(labelKey(evidenceItemPlacement("open"), "client")).toBe("waitingYou");
    expect(labelKey(evidenceItemPlacement("rejected"), "firm")).toBe("waitingClient");
    expect(labelKey(infoRequestPlacement("received"), "client")).toBe("waitingFirm");
  });

  it("inquiries and projects", () => {
    expect(wordKey(inquiryPlacement("new"), "firm")).toBe("waitingFirm");
    expect(wordKey(inquiryPlacement("proposal_sent"), "firm")).toBe("waitingClient");
    expect(inquiryPlacement("spam").word).toBe("closed");
    expect(labelKey(projectPlacement("draft"), "firm")).toBe("items.pitch");
    expect(wordKey(projectPlacement("closing"), "firm")).toBe("inProgress");
  });
});

describe.each([
  ["ar", ar],
  ["en", en],
])("%s words", (lang, messages) => {
  const words = (messages as unknown as { statusWords: Record<string, unknown> & { items: Record<string, string> } }).statusWords;

  it("has one label per word and per part's label", () => {
    for (const k of ["notStarted", "inProgress", "waitingFirm", "waitingClient", "waitingYou", "needsAttention", "verified", "closed"]) {
      expect(typeof words[k], k).toBe("string");
    }
    for (const k of ["accepted", "notNeeded", "notApplicable", "held", "cancelled", "pitch", "draft"]) expect(typeof words.items[k], k).toBe("string");
  });

  it("each word is its own (one word per thing)", () => {
    const labels = ["notStarted", "inProgress", "waitingFirm", "waitingClient", "waitingYou", "needsAttention", "verified", "closed"].map((k) => words[k]);
    expect(new Set(labels).size).toBe(labels.length);
  });

  if (lang === "ar") {
    it("speaks Arabic first, as decided", () => {
      expect(words.notStarted).toBe("لم يبدأ");
      expect(words.inProgress).toBe("قيد التنفيذ");
      expect(words.waitingFirm).toBe("بانتظار المكتب");
      expect(words.waitingYou).toBe("بانتظاركم");
      expect(words.needsAttention).toBe("يحتاج متابعة");
      expect(words.verified).toBe("تم التحقق");
      expect(words.closed).toBe("مغلق");
      expect(words.items.accepted).toBe("مقبول");
    });
  }
});

describe("lists and badges draw the word", () => {
  const root = fileURLToPath(new URL("../src/", import.meta.url));
  const read = (f: string) => readFileSync(root + f, "utf8");

  it("the status badge takes the reader and draws statusWords", () => {
    const badge = read("components/status-badge.tsx");
    expect(badge).toContain("statusWords");
    expect(badge).toMatch(/reader: Reader/);
  });

  it.each([
    "components/actions-table.tsx",
    "components/action-board-table.tsx",
    "components/home/firm-home.tsx",
    "components/client-progress.tsx",
    "app/(app)/projects/[id]/plan-actions.tsx",
    "app/(app)/recommendations/[id]/page.tsx",
    "app/(app)/clients/[id]/page.tsx",
    "app/(app)/engagements/[id]/page.tsx",
    "app/(app)/inquiries/page.tsx",
    "app/(app)/projects/[id]/info-requests-tab.tsx",
    "app/(app)/actions/[id]/what-to-send.tsx",
  ])("%s", (f) => {
    const text = read(f);
    expect(text).toMatch(/StatusBadge|WordBadge|status-words/);
    // No list draws a stored state's own label as its badge.
    expect(text).not.toMatch(/ToneBadge[^>]*>\{t\w*\(`(states|statuses|status)\.\$\{/);
  });
});
