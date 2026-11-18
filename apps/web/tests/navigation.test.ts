// One sidebar per role, the user menu, and where the removed rows went (page
// audit 4.1, batch 2, U09). The sidebar only reflects what the server decided
// a person may open; these tests pin which rows each role gets, including the
// rows "shown only when they apply", and that every page a row used to reach
// still has a way in.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import ar from "../messages/ar.json";
import en from "../messages/en.json";
import config from "../next.config";
import { clientAssistant, sidebarFor, userMenuFor, type NavFacts, type NavSection } from "@/lib/nav";
import { clientPeopleTabs, firmTeamTabs } from "@/lib/people-tabs";
import { clientTeamLine, splitPitches } from "@/lib/clients-list";

const rows = (sections: NavSection[]) => sections.flatMap((s) => s.rows.map((r) => r.key));
const groups = (sections: NavSection[]) => sections.map((s) => [s.label, s.rows.map((r) => r.key)]);
const row = (sections: NavSection[], key: string) => sections.flatMap((s) => s.rows).find((r) => r.key === key);
const none: NavFacts = {};

describe("the firm admin's sidebar", () => {
  it("is Home, Projects, Clients, Actions, Inquiries, Assistant, then Organisation: Team, Assessment templates, Audit log; no sub-entries", () => {
    const nav = sidebarFor("firm_admin", none);
    expect(groups(nav)).toEqual([
      ["workspace", ["home", "projects", "clients", "actions", "inquiries", "assistant"]],
      ["organization", ["team", "templates", "audit"]],
    ]);
    // Nine rows in the groups; Files is the tenth, at the foot.
    expect(rows(nav)).toHaveLength(9);
    expect(nav.flatMap((s) => s.rows).every((r) => !("items" in r))).toBe(true);
  });

  it("points Home at / and keeps Actions marked on the review and oversight pages", () => {
    const nav = sidebarFor("firm_admin", none);
    expect(row(nav, "home")).toMatchObject({ href: "/" });
    expect(row(nav, "actions")).toMatchObject({ href: "/actions", match: ["/review", "/oversight"] });
    expect(row(nav, "assistant")).toMatchObject({ card: true });
    // Today has no row of its own: it lives inside Home.
    expect(rows(nav)).not.toContain("today");
  });
});

describe("a consultant's sidebar", () => {
  it("is Home, Projects, Clients, Actions and Assistant when nothing else applies", () => {
    expect(groups(sidebarFor("consultant", none))).toEqual([["workspace", ["home", "projects", "clients", "actions", "assistant"]]]);
  });

  it("adds Inquiries only while one is assigned to them", () => {
    expect(rows(sidebarFor("consultant", { inquiryAssigned: true }))).toEqual(["home", "projects", "clients", "actions", "inquiries", "assistant"]);
  });

  it("adds Team only for a consultant who leads a client, and Assessment templates only for a named author", () => {
    expect(groups(sidebarFor("consultant", { leadsClient: true }))).toEqual([
      ["workspace", ["home", "projects", "clients", "actions", "assistant"]],
      ["organization", ["team"]],
    ]);
    expect(groups(sidebarFor("consultant", { templateAuthor: true }))).toEqual([
      ["workspace", ["home", "projects", "clients", "actions", "assistant"]],
      ["organization", ["templates"]],
    ]);
    expect(groups(sidebarFor("consultant", { leadsClient: true, templateAuthor: true, inquiryAssigned: true }))).toEqual([
      ["workspace", ["home", "projects", "clients", "actions", "inquiries", "assistant"]],
      ["organization", ["team", "templates"]],
    ]);
  });

  it("never gets the audit log, whatever applies", () => {
    expect(rows(sidebarFor("consultant", { leadsClient: true, templateAuthor: true, inquiryAssigned: true }))).not.toContain("audit");
  });

  it("ignores client facts", () => {
    expect(rows(sidebarFor("consultant", { inGroup: true, assistant: "consent" }))).toEqual(["home", "projects", "clients", "actions", "assistant"]);
  });
});

describe("the client admin's sidebar", () => {
  it("is Home, Projects, Actions, then Company: People and Audit log", () => {
    expect(groups(sidebarFor("client_admin", none))).toEqual([
      ["workspace", ["home", "projects", "actions"]],
      ["company", ["people", "audit"]],
    ]);
  });

  it("shows the assistant as soon as the firm offers it: the consent view before consent, the card once it is on", () => {
    const offered = sidebarFor("client_admin", { assistant: "consent" });
    expect(rows(offered)).toEqual(["home", "projects", "actions", "assistant", "people", "audit"]);
    expect(row(offered, "assistant")).toMatchObject({ href: "/assistant/consent", card: false });
    expect(row(sidebarFor("client_admin", { assistant: "card" }), "assistant")).toMatchObject({ card: true });
  });

  it("shows Our group only when the firm granted it", () => {
    expect(groups(sidebarFor("client_admin", { inGroup: true }))).toEqual([
      ["workspace", ["home", "projects", "actions"]],
      ["company", ["people", "group", "audit"]],
    ]);
  });

  it("marks People on the departments and structure pages, which are its tabs", () => {
    expect(row(sidebarFor("client_admin", none), "people")).toMatchObject({ href: "/team", match: ["/departments"] });
  });
});

describe("the client manager's sidebar", () => {
  it("is Home, Projects, Actions and one read-only People row (no Team and Departments pair, no audit log)", () => {
    expect(groups(sidebarFor("client_manager", none))).toEqual([
      ["workspace", ["home", "projects", "actions"]],
      ["company", ["people"]],
    ]);
  });

  it("shows the assistant only when it is on for them", () => {
    expect(rows(sidebarFor("client_manager", { assistant: "card" }))).toContain("assistant");
    // A manager never consents: the consent view is the admin's.
    expect(rows(sidebarFor("client_manager", { assistant: "consent" }))).not.toContain("assistant");
  });

  it("keeps Our group where the firm named them for it, as today", () => {
    expect(rows(sidebarFor("client_manager", { inGroup: true }))).toEqual(["home", "projects", "actions", "people", "group"]);
  });
});

describe("the action owner's sidebar", () => {
  it("is My actions (the home) and Projects; nothing else, whatever the facts say", () => {
    const nav = sidebarFor("action_owner", { inGroup: true, assistant: "card", leadsClient: true });
    expect(groups(nav)).toEqual([["workspace", ["myActions", "projects"]]]);
    // One page: the home is My actions, and it stays marked on the Actions list.
    expect(row(nav, "myActions")).toMatchObject({ href: "/", match: ["/actions"] });
  });
});

describe("the client assistant's row and consent view (page audit row 15)", () => {
  const ai = (x: Partial<{ on: boolean; canConsent: boolean; canWithdraw: boolean }>) => ({ on: false, canConsent: false, canWithdraw: false, ...x });

  it("opens the card for anyone it is on for", () => {
    expect(clientAssistant(ai({ on: true }))).toEqual({ row: "card", consentView: false });
    expect(clientAssistant(ai({ on: true, canWithdraw: true }))).toEqual({ row: "card", consentView: true });
  });

  it("opens the consent view for the admin before consent, and after it when the admin is not among the roles it was offered to", () => {
    expect(clientAssistant(ai({ canConsent: true }))).toEqual({ row: "consent", consentView: true });
    expect(clientAssistant(ai({ canWithdraw: true }))).toEqual({ row: "consent", consentView: true });
  });

  it("shows nothing where it is not offered, and to the firm", () => {
    expect(clientAssistant(ai({}))).toEqual({ row: null, consentView: false });
    expect(clientAssistant(null)).toEqual({ row: null, consentView: false });
  });
});

describe("the user menu", () => {
  const keys = (items: { key: string }[]) => items.map((i) => i.key);

  it("firm admin: Settings, Mail options, two-step sign-in", () => {
    expect(keys(userMenuFor("firm_admin", {}))).toEqual(["settings", "mailOptions", "security"]);
  });

  it("consultant: My expertise, Mail options, two-step sign-in", () => {
    const menu = userMenuFor("consultant", {});
    expect(keys(menu)).toEqual(["myExpertise", "mailOptions", "security"]);
    expect(menu[0]).toMatchObject({ href: "/team/expertise" });
  });

  it("client admin: keeps Data sharing, adds Assistant consent once the firm offered it, and Mail options; Help stays in the same place", () => {
    expect(keys(userMenuFor("client_admin", {}))).toEqual(["dataSharing", "mailOptions", "security", "help"]);
    const offered = userMenuFor("client_admin", { assistantConsent: true });
    expect(keys(offered)).toEqual(["dataSharing", "assistantConsent", "mailOptions", "security", "help"]);
    expect(offered.find((i) => i.key === "assistantConsent")).toMatchObject({ href: "/assistant/consent" });
  });

  it("client manager and action owner: Mail options, two-step sign-in, Help; never the admin's items", () => {
    for (const role of ["client_manager", "action_owner"] as const) {
      expect(keys(userMenuFor(role, { assistantConsent: true }))).toEqual(["mailOptions", "security", "help"]);
    }
  });

  it("sends Mail options to its own view, the two-step sign-in to /security", () => {
    for (const role of ["firm_admin", "consultant", "client_admin", "client_manager", "action_owner"] as const) {
      const menu = userMenuFor(role, {});
      expect(menu.find((i) => i.key === "mailOptions")).toMatchObject({ href: "/notifications/mail" });
      expect(menu.find((i) => i.key === "security")).toMatchObject({ href: "/security" });
    }
  });

  it("no longer holds language or theme: they stay in the top bar only (October item 6)", () => {
    const menu = readFileSync("src/components/nav-user.tsx", "utf8");
    expect(menu).not.toMatch(/setLocale|setTheme|useTheme/);
    const layout = readFileSync("src/app/(app)/layout.tsx", "utf8");
    expect(layout).toMatch(/<LocaleToggle/);
    expect(layout).toMatch(/<ThemeSwitch/);
  });
});

describe("every label exists in Arabic and English", () => {
  const facts: NavFacts = { leadsClient: true, templateAuthor: true, inquiryAssigned: true, inGroup: true, assistant: "consent" };
  it("for every row, group and menu item of every role", () => {
    for (const role of ["firm_admin", "consultant", "client_admin", "client_manager", "action_owner"] as const) {
      for (const s of sidebarFor(role, facts)) {
        for (const m of [ar, en]) {
          expect(m.nav[s.label as keyof typeof m.nav]).toBeTruthy();
          for (const r of s.rows) expect(m.nav[r.key as keyof typeof m.nav], `${role} ${r.key}`).toBeTruthy();
        }
      }
      for (const i of userMenuFor(role, { assistantConsent: true })) {
        for (const m of [ar, en]) expect(m.nav[i.key as keyof typeof m.nav], `${role} ${i.key}`).toBeTruthy();
      }
    }
    expect(ar.nav.home).toBe("الرئيسية");
    expect(en.nav.home).toBe("Home");
  });
});

describe("where the removed rows live", () => {
  it("client groups are a view on Clients: the old address redirects there, and no page of its own is left", async () => {
    const redirects = (await config.redirects?.()) ?? [];
    expect(redirects).toContainEqual({ source: "/clients/groups", destination: "/clients?view=groups", permanent: true });
    expect(existsSync("src/app/(app)/clients/groups/page.tsx")).toBe(false);
    // One group's page stays, and leads back to the view.
    const group = readFileSync("src/app/(app)/clients/groups/[id]/page.tsx", "utf8");
    expect(group).toContain('"/clients?view=groups"');
    expect(group).not.toMatch(/["`]\/clients\/groups["`]/);
  });

  it("Clients carries the groups view and 'Enter an inquiry'", () => {
    const page = readFileSync("src/app/(app)/clients/page.tsx", "utf8");
    expect(page).toMatch(/view === "groups"/);
    expect(page).toMatch(/<EnterInquiryDialog/);
  });

  it("Projects carries the kind filter that the three sub-entries were", () => {
    const page = readFileSync("src/app/(app)/projects/page.tsx", "utf8");
    for (const href of ['"/projects"', '"/projects?kind=client"', '"/projects?kind=internal"']) expect(page).toContain(href);
  });

  it("Expertise is a tab on Team", () => {
    expect(firmTeamTabs()).toEqual(["people", "expertise"]);
    for (const f of ["src/app/(app)/team/page.tsx", "src/app/(app)/team/expertise/page.tsx"]) expect(readFileSync(f, "utf8")).toMatch(/<TeamTabs/);
  });

  it("the client's Departments and Structure are tabs of People, each keeping its address", () => {
    // The admin keeps the Departments tab while departments are off: the switch lives there.
    expect(clientPeopleTabs({ admin: true, departmentsEnabled: false, structure: false })).toEqual(["people", "departments"]);
    expect(clientPeopleTabs({ admin: true, departmentsEnabled: true, structure: true })).toEqual(["people", "departments", "structure"]);
    // A manager sees departments (with their heads) only where they are on; the Structure once there is one.
    expect(clientPeopleTabs({ admin: false, departmentsEnabled: true, structure: false })).toEqual(["people", "departments"]);
    expect(clientPeopleTabs({ admin: false, departmentsEnabled: false, structure: true })).toEqual(["people", "structure"]);
    expect(clientPeopleTabs({ admin: false, departmentsEnabled: false, structure: false })).toEqual(["people"]);
    for (const f of ["src/app/(app)/team/page.tsx", "src/app/(app)/departments/page.tsx", "src/app/(app)/departments/structure/page.tsx"]) {
      expect(readFileSync(f, "utf8"), f).toMatch(/<ClientPeopleTabs/);
    }
  });

  it("Notifications is the list alone; mail options and muted actions have their own view", () => {
    const list = readFileSync("src/app/(app)/notifications/page.tsx", "utf8");
    expect(list).not.toMatch(/MailChoicesForm|MutedActions/);
    const mail = readFileSync("src/app/(app)/notifications/mail/page.tsx", "utf8");
    expect(mail).toMatch(/<MailChoicesForm/);
    expect(mail).toMatch(/<MutedActions/);
  });

  it("a template is reached from the assessment that uses it, now that the row is for authors only", () => {
    expect(readFileSync("src/app/(app)/assessments/[id]/page.tsx", "utf8")).toMatch(/href=\{`\/templates\/\$\{/);
  });

  it("the assistant's consent view is its own page", () => {
    expect(existsSync("src/app/(app)/assistant/consent/page.tsx")).toBe(true);
  });
});

describe("the Clients list (October item 3)", () => {
  const T = (lead: string | null, others: number) => clientTeamLine({ lead, others: Array.from({ length: others }, (_, i) => `C${i}`) });

  it("names the lead and counts the others, instead of two-letter chips", () => {
    expect(T("Khalid", 0)).toEqual({ kind: "lead", lead: "Khalid", others: 0 });
    expect(T("Khalid", 2)).toEqual({ kind: "lead", lead: "Khalid", others: 2 });
  });

  it("says so when there is no lead, or nobody at all", () => {
    expect(T(null, 3)).toEqual({ kind: "noLead", others: 3 });
    expect(T(null, 0)).toEqual({ kind: "nobody" });
  });

  it("puts pitches in their own table and keeps the clients in theirs, in order", () => {
    const list = [
      { id: "a", prospect: false },
      { id: "p", prospect: true },
      { id: "b", prospect: false },
    ];
    expect(splitPitches(list)).toEqual({ clients: [list[0], list[2]], pitches: [list[1]] });
  });

  it("has its words in both languages", () => {
    for (const m of [ar, en]) {
      expect(m.staffing.andOthers).toBeTruthy();
      expect(m.staffing.consultantsCount).toBeTruthy();
      expect(m.staffing.pitches).toBeTruthy();
    }
  });
});
