import type { Role } from "@/authz";

// One sidebar per role and the user menu (page audit 4.1, batch 2, U09).
// This only decides which rows to draw from what the server already knows
// about the reader; it is not the access control. Every page checks its own
// reader on the server, and a page a row no longer points to keeps its
// address and its own way in (tests/navigation.test.ts).

/** What the server found out about the reader that decides the rows "shown only when they apply". */
export interface NavFacts {
  /** A consultant who is the lead or the deputy of at least one client: Team is where they see who can do what. */
  leadsClient?: boolean;
  /** A consultant the firm admin named as an assessment template author. */
  templateAuthor?: boolean;
  /** A consultant with an inquiry assigned to them. */
  inquiryAssigned?: boolean;
  /** A client person the firm admin named to see their holding group (F34). */
  inGroup?: boolean;
  /** The client assistant (F39): the card once it is on for this person, or the client admin's consent view. See clientAssistant(). */
  assistant?: "card" | "consent" | null;
}

export type NavKey =
  | "home"
  | "myActions"
  | "projects"
  | "clients"
  | "actions"
  | "inquiries"
  | "assistant"
  | "team"
  | "templates"
  | "audit"
  | "people"
  | "group";

export interface NavRow {
  key: NavKey;
  href: string;
  /** The assistant: opens its floating card instead of a page. */
  card?: boolean;
  /** Other addresses this row stands for (its tabs and filters), so it stays marked there. */
  match?: string[];
}

export interface NavSection {
  /** The group's label (messages nav.*): the first group is the workspace. */
  label: "workspace" | "organization" | "company";
  rows: NavRow[];
}

const home: NavRow = { key: "home", href: "/" };
const projects: NavRow = { key: "projects", href: "/projects" };
const audit: NavRow = { key: "audit", href: "/audit" };

/**
 * The sidebar for a role. No sub-entries: what they were now lives on the
 * pages (the kind filter on Projects, the groups view on Clients, Expertise
 * as a tab of Team, Departments and Structure as tabs of the client's People).
 */
export function sidebarFor(role: Role, facts: NavFacts): NavSection[] {
  if (role === "firm_admin" || role === "consultant") {
    const admin = role === "firm_admin";
    const sections: NavSection[] = [
      {
        label: "workspace",
        rows: [
          home,
          projects,
          { key: "clients", href: "/clients" },
          // One list with filters (/actions?filter=…): the row is marked on every filtered address, as they share its path.
          { key: "actions", href: "/actions" },
          ...(admin || facts.inquiryAssigned ? [{ key: "inquiries" as const, href: "/inquiries" }] : []),
          { key: "assistant", href: "/assistant", card: true },
        ],
      },
      {
        label: "organization",
        rows: [
          ...(admin || facts.leadsClient ? [{ key: "team" as const, href: "/team" }] : []),
          ...(admin || facts.templateAuthor ? [{ key: "templates" as const, href: "/templates" }] : []),
          ...(admin ? [audit] : []),
        ],
      },
    ];
    return sections.filter((s) => s.rows.length > 0);
  }
  if (role === "action_owner") {
    // One page: the home is the owner's actions.
    return [{ label: "workspace", rows: [{ key: "myActions", href: "/", match: ["/actions"] }, projects] }];
  }
  const admin = role === "client_admin";
  const assistant: NavRow[] =
    facts.assistant === "card"
      ? [{ key: "assistant", href: "/assistant", card: true }]
      : facts.assistant === "consent" && admin
        ? [{ key: "assistant", href: "/assistant/consent", card: false, match: ["/assistant"] }]
        : [];
  return [
    { label: "workspace", rows: [home, projects, { key: "actions", href: "/actions" }, ...assistant] },
    {
      label: "company",
      rows: [
        // The company's people; departments and the structure are its tabs (read-only for managers).
        { key: "people", href: "/team", match: ["/departments"] },
        // The group's roll-up is a section of the home (October item 8); /group redirects there.
        ...(facts.inGroup ? [{ key: "group" as const, href: "/#group" }] : []),
        ...(admin ? [audit] : []),
      ],
    },
  ];
}

/** Help at the foot of the sidebar, above Files: every client role, always in the same place (F13). */
export function hasHelp(role: Role) {
  return role === "client_admin" || role === "client_manager" || role === "action_owner";
}

/**
 * The client assistant's row (page audit row 15). It shows as soon as the
 * firm offers it to the client admin: before consent (or when the admin is
 * not among the roles it was offered to) it opens the consent view; once it
 * is on for the person it opens the card. A manager sees it only when on.
 */
export function clientAssistant(ai: { on: boolean; canConsent: boolean; canWithdraw: boolean } | null): {
  row: "card" | "consent" | null;
  /** "Assistant consent" in the user menu: what was agreed, by whom and when, and the switch to withdraw. */
  consentView: boolean;
} {
  if (!ai) return { row: null, consentView: false };
  const consentView = ai.canConsent || ai.canWithdraw;
  return { row: ai.on ? "card" : consentView ? "consent" : null, consentView };
}

export type MenuKey = "settings" | "myExpertise" | "dataSharing" | "assistantConsent" | "mailOptions" | "security" | "help";

/**
 * The menu under the person's name at the foot of the sidebar. Language and
 * theme are not here: they stay in the top bar (October review item 6).
 * Sign out always closes it.
 */
export function userMenuFor(role: Role, facts: { assistantConsent?: boolean }): { key: MenuKey; href: string }[] {
  const items: { key: MenuKey; href: string }[] = [];
  if (role === "firm_admin") items.push({ key: "settings", href: "/settings" });
  // A consultant edits their own line of the Expertise tab from here.
  if (role === "consultant") items.push({ key: "myExpertise", href: "/team/expertise" });
  if (role === "client_admin") {
    items.push({ key: "dataSharing", href: "/indicators/data" });
    if (facts.assistantConsent) items.push({ key: "assistantConsent", href: "/assistant/consent" });
  }
  items.push({ key: "mailOptions", href: "/notifications/mail" }, { key: "security", href: "/security" });
  if (hasHelp(role)) items.push({ key: "help", href: "/help" });
  return items;
}
