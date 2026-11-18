// The home page per role (page audit 4.2, batch 2; decision D2): Today
// became the home, so its old address sends people there for good; each list
// shows five rows and "Show all" opens that same list in full; an action
// owner's work falls in three groups in a fixed order; the firm's counters
// lead to the Actions filters. The database side is tests/db/home.test.ts.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import ar from "../messages/ar.json";
import en from "../messages/en.json";
import config from "../next.config";
import {
  ACTIONS_FILTERS,
  byWaiting,
  HOME_ROWS,
  HOME_SECTIONS,
  openSection,
  ownerGroup,
  ownerNextStep,
  showAllHref,
  shown,
} from "@/lib/home";

describe("the old addresses", () => {
  it("send /today and /group to the home for good, and no page of theirs is left", async () => {
    const redirects = (await config.redirects?.()) ?? [];
    expect(redirects).toContainEqual({ source: "/today", destination: "/", permanent: true });
    expect(redirects).toContainEqual({ source: "/group", destination: "/#group", permanent: true });
    expect(existsSync("src/app/(app)/today")).toBe(false);
    expect(existsSync("src/app/(app)/group")).toBe(false);
  });

  it("send a client's message to the firm's management to the admin's home, in the app and in the mail", () => {
    expect(readFileSync("src/services/notifications.ts", "utf8")).toMatch(/support\.requested"\) return "\/#problems"/);
    expect(readFileSync("drizzle/0200_home_problem_link.sql", "utf8")).toMatch(/'support\.requested', '\/#problems'/);
    // The Notifications page is the list alone: the messages are no longer drawn there.
    expect(readFileSync("src/app/(app)/notifications/page.tsx", "utf8")).not.toMatch(/listSupportRequests|help\.support/);
  });
});

describe("five rows and Show all", () => {
  const rows = Array.from({ length: 8 }, (_, i) => i);

  it("shows the first five rows, and every row once the section is opened", () => {
    expect(HOME_ROWS).toBe(5);
    expect(shown(rows, false)).toEqual([0, 1, 2, 3, 4]);
    expect(shown(rows, true)).toEqual(rows);
    expect(shown([1, 2], false)).toEqual([1, 2]);
  });

  it("opens the same list on the same page, so the count and the list it opens agree", () => {
    expect(showAllHref("reviews")).toBe("/?all=reviews#reviews");
    expect(openSection("reviews")).toBe("reviews");
    expect(openSection(["due", "x"])).toBe("due");
    expect(openSection("nothing")).toBeNull();
    expect(openSection(undefined)).toBeNull();
    for (const s of HOME_SECTIONS) expect(openSection(new URL(showAllHref(s), "http://x").searchParams.get("all") ?? undefined)).toBe(s);
  });
});

describe("an action owner's three groups", () => {
  it("puts each state in one group, and a draft in none (D6)", () => {
    expect(["assigned", "in_progress", "blocked", "revision_requested"].map(ownerGroup)).toEqual(["waiting", "waiting", "waiting", "waiting"]);
    expect(ownerGroup("awaiting_review")).toBe("withConsultant");
    expect(["verified_complete", "closed"].map(ownerGroup)).toEqual(["finished", "finished"]);
    expect(ownerGroup("draft")).toBeNull();
  });

  it("orders 'waiting for you': sent back and late first, then in progress, then not started; by due date inside each", () => {
    const row = (id: string, status: string, dueDate: string | null, overdue = false) => ({ id, status, dueDate, overdue });
    const sorted = byWaiting([
      row("new-soon", "assigned", "2026-12-01"),
      row("going", "in_progress", "2026-12-20"),
      row("stopped", "blocked", "2026-12-10"),
      row("late", "in_progress", "2026-11-01", true),
      row("sent-back", "revision_requested", "2026-12-30"),
      row("new-undated", "assigned", null),
    ]);
    expect(sorted.map((r) => r.id)).toEqual(["late", "sent-back", "stopped", "going", "new-soon", "new-undated"]);
  });

  it("names the step that waits on the action's page", () => {
    expect(["assigned", "in_progress", "revision_requested", "blocked", "awaiting_review", "verified_complete"].map(ownerNextStep)).toEqual([
      "start",
      "sendForReview",
      "resend",
      "resume",
      "open",
      "open",
    ]);
    for (const step of ["start", "sendForReview", "resend", "resume", "open"] as const) {
      expect(ar.home.steps[step], step).toBeTruthy();
      expect(en.home.steps[step], step).toBeTruthy();
    }
  });
});

describe("the firm's counters", () => {
  it("each open a filter of the Actions list, and say counts, never a health word (D5)", () => {
    for (const href of Object.values(ACTIONS_FILTERS)) expect(href).toMatch(/^\/actions\?filter=[a-z-]+(&waiting=long)?$/);
    const words = [...Object.values(en.home.firm.counters), ...Object.values(ar.home.firm.counters)].join(" ");
    expect(words).not.toMatch(/off track|on track|watch|خارج المسار|على المسار|تحت المراقبة/i);
  });
});

describe("the home's words", () => {
  it("is called «الرئيسية» / Home for every role", () => {
    expect(ar.home.title).toBe("الرئيسية");
    expect(en.home.title).toBe("Home");
  });

  it("speaks to the client and the owner about their own company, never about 'the client'", () => {
    const client = JSON.stringify([en.home.client, en.home.mine, en.home.owner]);
    expect(client).not.toMatch(/\bclients?\b|client's/i);
    const clientAr = JSON.stringify([ar.home.client, ar.home.mine, ar.home.owner]);
    expect(clientAr).not.toMatch(/العميل|عميل/);
  });
});
