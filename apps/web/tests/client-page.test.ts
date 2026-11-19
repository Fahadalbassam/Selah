// Batch 5 (page audit 4.4, U07): the firm's client page in three tabs,
// Overview · People · Setup; its two sub-pages redirect to People. Checked on
// the shared tab module and on the page's source, as project-page.test.ts does.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CLIENT_TABS, OLD_CLIENT_PAGES, clientTab, clientTabHref, oldClientPageTarget } from "@/lib/client-tabs";
import ar from "../messages/ar.json";
import en from "../messages/en.json";

const source = (path: string) => readFileSync(join(__dirname, "../src", path), "utf8");
const page = () => source("app/(app)/clients/[id]/page.tsx");
const get = (o: unknown, key: string): unknown => key.split(".").reduce<unknown>((x, k) => (x as Record<string, unknown> | undefined)?.[k], o);
const ID = "11111111-2222-4333-8444-555555555555";

describe("the tab set", () => {
  it("is Overview · People · Setup", () => {
    expect(CLIENT_TABS).toEqual(["overview", "people", "setup"]);
  });

  it("opens Overview for anything else, and Overview's address is the client's own", () => {
    expect(clientTab(undefined)).toBe("overview");
    expect(clientTab("departments")).toBe("overview");
    expect(clientTab("setup")).toBe("setup");
    expect(clientTabHref(ID, "overview")).toBe(`/clients/${ID}`);
    expect(clientTabHref(ID, "people", "departments")).toBe(`/clients/${ID}?tab=people#departments`);
  });

  it("the tab row draws the three, and Structure after them once there is one", () => {
    const tabs = source("app/(app)/clients/[id]/client-tabs.tsx");
    expect(tabs).toContain("CLIENT_TABS.map");
    expect(tabs).toContain("structure");
    expect(tabs).not.toContain("/departments`");
  });

  it("each tab has its name in both languages", () => {
    for (const m of [ar, en]) for (const k of [...CLIENT_TABS, "label"]) expect(typeof get(m, `clientPage.tabs.${k}`), k).toBe("string");
  });
});

describe("the old sub-pages redirect", () => {
  it("accounts and departments are sections of People", () => {
    expect(oldClientPageTarget(ID, "people")).toBe(`/clients/${ID}?tab=people#accounts`);
    expect(oldClientPageTarget(ID, "departments")).toBe(`/clients/${ID}?tab=people#departments`);
    expect(Object.keys(OLD_CLIENT_PAGES).sort()).toEqual(["departments", "people"]);
  });

  it.each(["people", "departments"] as const)("/clients/:id/%s only redirects", (p) => {
    const s = source(`app/(app)/clients/[id]/${p}/page.tsx`);
    expect(s).toContain("redirect(");
    expect(s).toContain(`oldClientPageTarget(id, "${p}")`);
    expect(s).not.toMatch(/withPrincipal|PeopleAdmin|DepartmentsManager/);
  });

  it("no link in the app points at an old sub-page any more", () => {
    const files = [
      "app/(app)/departments/[id]/page.tsx",
      "app/(app)/clients/[id]/structure/page.tsx",
      "app/(app)/team/page.tsx",
      "components/home/firm-home.tsx",
      "lib/nav.ts",
    ];
    for (const f of files) {
      let s = "";
      try {
        s = source(f);
      } catch {
        continue;
      }
      expect(s, f).not.toMatch(/\/clients\/\$\{[^}]+\}\/(people|departments)\b/);
    }
  });
});

describe("links to what moved off Overview land on its tab (review S4)", () => {
  it("a join request on the firm admin's home opens People, at the requests", () => {
    expect(source("services/today.ts")).toMatch(/href: clientTabHref\(j\.clientOrgId, "people", "join-requests"\)/);
  });

  it("the client-assistant and export-pack notices open Setup, where their cards are", () => {
    const n = source("services/notifications.ts");
    expect(n).toMatch(/kind\.startsWith\("client_ai\."\)\) return clientTabHref\(entityId, "setup"\)/);
    expect(n).toMatch(/kind === "client\.pack_received"\) return clientTabHref\(entityId, "setup"\)/);
  });

  it("a client lead held by someone leaving opens People, where the lead is set", () => {
    expect(source("app/(app)/team/departure-dialog.tsx")).toMatch(/client_lead"\s*\?\s*clientTabHref\(h\.entityId, "people"\)/);
  });
});

describe("what each tab holds (page audit 4.4)", () => {
  it("Overview: progress, indicators, projects with New project, the join-request notice", () => {
    const s = page();
    const overview = s.slice(s.indexOf('{current === "overview" ? ('), s.indexOf('{current === "people" ? ('));
    for (const piece of ["<ClientProgress", "<IndicatorsCard", 'tPh("new")', "joinWaiting"]) expect(overview, piece).toContain(piece);
  });

  it("People: the firm's team, accounts, contacts, join requests, departments", () => {
    const s = page();
    const people = s.slice(s.indexOf('{current === "people" ? ('), s.indexOf('{current === "setup" ? ('));
    for (const piece of ['t("teamTitle")', "<PeopleAdmin", 'tCt("title")', 't("joinRequests")', "<DepartmentsManager", 'id="accounts"', 'id="departments"', 'id="join-requests"'])
      expect(people, piece).toContain(piece);
  });

  it("Setup: how it takes part, legal profile, short names, second sign-off, assistant, engagements, archive, conflict check", () => {
    const s = page();
    const setup = s.slice(s.indexOf('{current === "setup" ? ('));
    for (const piece of ["<EngagementCard", "<LegalProfileCard", "shortNames.title", "<SecondReviewRuleCard", "<ClientAiCard", 'tE("title")', "<OffboardingCard", "conflictCheck"])
      expect(setup, piece).toContain(piece);
  });

  it("suggested consultants are inside the Add a consultant dialog, not a card of their own", () => {
    const s = page();
    expect(s).not.toContain('ti("leads")');
    expect(s).toMatch(/suggested/);
  });

  it("the header holds no buttons: watch and delete are in the page's menu", () => {
    const s = page();
    const header = s.slice(s.indexOf("<PageHeader"), s.indexOf("</PageHeader>"));
    expect(header).not.toContain("<ApiButton");
    expect(header).toContain("<ClientPageMenu");
  });
});
