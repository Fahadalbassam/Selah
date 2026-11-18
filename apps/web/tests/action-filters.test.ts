// Batch 2, part C (page audit 4.6, D2 and D5): the Actions list's filters are
// addresses the home and old links can point at; /review and /oversight send
// people to the matching filter before any page is drawn; and no screen or
// message keeps Oversight's "Off track / Watch / On track" word.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { NextIntlClientProvider } from "next-intl";
import { createElement, type ComponentProps, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import ar from "../messages/ar.json";
import en from "../messages/en.json";
import config from "../next.config";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {}, push() {} }), usePathname: () => "/actions" }));

import { ProjectsTable } from "@/app/(app)/projects/projects-table";
import { ActionBoardTable } from "@/components/action-board-table";
import { ActionFilterLinks } from "@/components/action-filters";
import type { BoardRow, ProjectTableRow } from "@/services/action-board";
import {
  ACTION_FILTERS,
  actionsHref,
  filtersFor,
  FIRM_RULE_FILTERS,
  LATE_HREF,
  parseActionsQuery,
  REVIEWS_WAITING_LONG_HREF,
  RULE_FILTERS,
} from "@/lib/action-filters";

const ID = "00000000-0000-4000-b2c0-000000000021";

describe("the old addresses", () => {
  it("send /review and /oversight to the matching Actions filter, and no page of their own is left", async () => {
    const redirects = (await config.redirects?.()) ?? [];
    expect(redirects).toContainEqual({ source: "/review", destination: "/actions?filter=awaiting-review", permanent: true });
    expect(redirects).toContainEqual({ source: "/oversight", destination: "/actions?filter=late", permanent: true });
    expect(existsSync("src/app/(app)/review")).toBe(false);
    expect(existsSync("src/app/(app)/oversight")).toBe(false);
    // Each destination is a filter the page reads.
    for (const r of redirects.filter((x) => x.source === "/review" || x.source === "/oversight")) {
      const q = parseActionsQuery(Object.fromEntries(new URL(r.destination, "http://x").searchParams));
      expect(actionsHref(q)).toBe(r.destination);
    }
  });
});

describe("the filters in the address", () => {
  it("read and write the same address, leaving out what is the default", () => {
    expect(actionsHref()).toBe("/actions");
    expect(actionsHref({ filter: "all", page: 1 })).toBe("/actions");
    expect(actionsHref({ filter: "late", project: ID })).toBe(`/actions?filter=late&project=${ID}`);
    expect(LATE_HREF).toBe("/actions?filter=late");
    expect(REVIEWS_WAITING_LONG_HREF).toBe("/actions?filter=awaiting-review&waiting=long");
    for (const filter of ACTION_FILTERS) {
      const href = actionsHref({ filter, client: ID, owner: ID, department: ID, page: 3 });
      expect(actionsHref(parseActionsQuery(Object.fromEntries(new URL(href, "http://x").searchParams)))).toBe(href);
    }
  });

  it("drops what it does not know: an unknown filter is the whole list, an id must be an id", () => {
    expect(parseActionsQuery({ filter: "overdue" }).filter).toBe("all");
    expect(parseActionsQuery({ project: "1 OR 1=1", owner: ID.toUpperCase() })).toMatchObject({ project: undefined, owner: ID });
    expect(parseActionsQuery({ page: "0" }).page).toBe(1);
    // "waiting=long" belongs to awaiting review only.
    expect(parseActionsQuery({ filter: "late", waiting: "long" }).waitingLong).toBe(false);
    expect(parseActionsQuery({ filter: "awaiting-review", waiting: "long" }).waitingLong).toBe(true);
  });

  it("offers the firm's measures to the firm only, and no 'mine' to an action owner", () => {
    expect(filtersFor({ firm: true, actionOwner: false })).toEqual([...ACTION_FILTERS]);
    const client = filtersFor({ firm: false, actionOwner: false });
    for (const f of FIRM_RULE_FILTERS) expect(client).not.toContain(f);
    expect(client).toEqual(["all", "mine", "awaiting-review", "late", "blocked"]);
    expect(filtersFor({ firm: false, actionOwner: true })).toEqual(["all", "awaiting-review", "late", "blocked"]);
  });

  it("has a name and a plain hint in both languages for every filter, Arabic first", () => {
    for (const messages of [ar, en]) {
      const filters = messages.actionsPage.filters as Record<string, { name: string; hint: string }>;
      for (const f of ACTION_FILTERS) {
        expect(filters[f]?.name, f).toBeTruthy();
        expect(filters[f]?.hint, f).toBeTruthy();
      }
    }
    // A client reads "Waiting for the firm", spoken to, never about "the client".
    expect(ar.actionsPage.filters["awaiting-review"].nameClient).toBe("بانتظار المكتب");
    expect(ar.actionsPage.filters["awaiting-review"].hintClient).not.toMatch(/العميل/);
    // The owner is «المكلَّف»; «متعثر» is a blocked action only.
    expect(ar.actionsPage.remind.menu).toBe("تذكير المكلَّف");
    expect(ar.actionsPage.filters.blocked.name).toMatch(/متعثر/);
    expect(RULE_FILTERS).toContain("blocked");
  });
});

describe("no health word (D5)", () => {
  const words = [/off[ _-]?track/i, /on[ _-]?track/i, /خارج المسار/, /على المسار/, /تحت المراقبة/];

  it("in either message catalogue", () => {
    for (const [name, messages] of [["ar", ar], ["en", en]] as const) {
      const text = JSON.stringify(messages);
      for (const w of words) expect(text, `${name} ${w}`).not.toMatch(w);
    }
  });

  it("on any screen", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx$/.test(f)) files.push(p);
      }
    };
    walk("src/app");
    walk("src/components");
    for (const f of files) expect(readFileSync(f, "utf8"), f).not.toMatch(/off_track|on_track|HealthSignal|signals\.(watch|off_track)/);
  });
});

const html = (locale: "ar" | "en", node: ReactNode) => {
  const props = { locale, messages: locale === "ar" ? ar : en, timeZone: "Asia/Riyadh" } as unknown as ComponentProps<typeof NextIntlClientProvider>;
  return renderToStaticMarkup(createElement(NextIntlClientProvider, props, node));
};
const text = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");

describe("the page draws what the service decided", () => {
  const row = (over: Partial<BoardRow>): BoardRow => ({
    id: "a1",
    title: "Publish the minutes",
    status: "blocked",
    dueDate: "2026-01-05",
    ownerName: "Salma",
    projectId: ID,
    projectTitle: "Board governance",
    recommendationTitle: "Adopt a board charter",
    late: true,
    reasons: [
      { rule: "late", n: 5 },
      { rule: "blocked", n: null },
    ],
    review: null,
    remind: null,
    ...over,
  });

  it("the lists as links with their counts, the chosen one marked, the facets kept", () => {
    const q = { ...parseActionsQuery({ filter: "late", project: ID }) };
    const firm = html("ar", createElement(ActionFilterLinks, { query: q, filters: filtersFor({ firm: true, actionOwner: false }), counts: { late: 3, blocked: 2 }, firm: true }));
    expect(firm).toContain(`href="/actions?filter=blocked&amp;project=${ID}"`);
    expect(firm).toMatch(/aria-current="page"[^>]*>متأخرة/);
    expect(text(firm)).toContain("متأخرة 3");
    expect(text(firm)).toContain("بلا نشاط 0");
    const client = html("ar", createElement(ActionFilterLinks, { query: q, filters: filtersFor({ firm: false, actionOwner: false }), counts: {}, firm: false }));
    expect(text(client)).toContain("بانتظار المكتب");
    expect(client).not.toContain("no-activity");
  });

  it("one row for an action both late and blocked, with both reasons, and the reminder only in its menu when allowed", () => {
    const one = html("ar", createElement(ActionBoardTable, { rows: [row({})], filter: "late", firm: true, empty: "" }));
    expect(one.match(/<tr/g)!.length).toBe(2); // the header and one row
    expect(text(one)).toContain("متأخر 5 أيام · متعثر");
    expect(one).not.toContain(ar.common.moreFor.replace("{name}", ""));
    const may = html("en", createElement(ActionBoardTable, { rows: [row({ remind: { can: true, remindedToday: false, lastReminded: null } })], filter: "late", firm: true, empty: "" }));
    expect(may).toContain(`aria-label="${en.common.moreFor.replace("{name}", "Publish the minutes")}"`);
    expect(text(may)).toContain("5 days late · Blocked");
    // No remind button on the row: it lives in the menu (the column's name is for screen readers).
    expect(may).not.toMatch(new RegExp(`<button[^>]*>[^<]*${en.actionsPage.remind.menu}`));
  });

  it("awaiting review: the waiting days for everyone, the sign-off stage for the firm only", () => {
    const r = row({ status: "awaiting_review", late: false, reasons: [], review: { waitingDays: 9, since: null, stage: { required: true, signedBy: "Omar", signedByMe: false, canAct: true } } });
    const firm = text(html("en", createElement(ActionBoardTable, { rows: [r], filter: "awaiting-review", firm: true, empty: "" })));
    expect(firm).toContain("9 days");
    expect(firm).toContain("Second of two");
    const client = text(html("en", createElement(ActionBoardTable, { rows: [{ ...r, review: { ...r.review!, stage: null } }], filter: "awaiting-review", firm: false, empty: "" })));
    expect(client).toContain("9 days");
    expect(client).not.toMatch(/of two|One review|Signed off/);
  });

  it("the Projects table: counts that open their lists, a closed project without counts, no health word", () => {
    const p = (over: Partial<ProjectTableRow>): ProjectTableRow => ({
      projectId: ID,
      title: "Board governance",
      kind: "client",
      pitch: false,
      state: "active",
      clientName: "Acme",
      clientNameAr: null,
      mode: "full",
      open: 6,
      late: 3,
      blocked: 0,
      oldestReviewDays: 9,
      lead: "Khalid",
      clientLastActive: null,
      ...over,
    });
    const out = html("ar", createElement(ProjectsTable, { rows: [p({}), p({ projectId: "x", state: "closed", open: null, late: null, blocked: null, oldestReviewDays: null })] }));
    expect(out).toContain(`href="/actions?filter=late&amp;project=${ID}"`);
    expect(out).toContain(`href="/actions?filter=awaiting-review&amp;project=${ID}"`);
    expect(out).not.toContain("filter=blocked"); // zero is plain
    expect(text(out)).toContain("لم يبدأ بعد");
    for (const w of [/خارج المسار/, /على المسار/, /تحت المراقبة/]) expect(out).not.toMatch(w);
  });
});
