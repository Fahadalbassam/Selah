// The firm's client page in three tabs (page audit 4.4, batch 5, U07).
// Plain module: the page, the old addresses that redirect and the tests share it.
//
//   Overview · People · Setup   (· Structure, its own address, once there is one)
//
// Overview: progress across projects, business indicators, projects with
// "New project", a notice when a join request waits. People: the firm's team
// on the client, the client's accounts, contacts without accounts, join
// requests, departments. Setup: how the client takes part, legal profile,
// short names, second sign-off, the client assistant, signed engagements,
// archive and retention, the conflict check (pitches).

export const CLIENT_TABS = ["overview", "people", "setup"] as const;
export type ClientTab = (typeof CLIENT_TABS)[number];

/** Sections of the People tab that old addresses and notices point at. */
export type PeopleSection = "accounts" | "departments" | "join-requests" | "handover";

/** The tab to open for `?tab=…`; anything else is Overview. */
export function clientTab(tab: string | undefined): ClientTab {
  return (CLIENT_TABS as readonly string[]).includes(tab ?? "") ? (tab as ClientTab) : "overview";
}

/** A tab's address. Overview, the default, has none; a section is its anchor. */
export function clientTabHref(clientId: string, tab: ClientTab, section?: PeopleSection): string {
  const base = tab === "overview" ? `/clients/${clientId}` : `/clients/${clientId}?tab=${tab}`;
  return section ? `${base}#${section}` : base;
}

/**
 * The client page's two sub-pages before batch 5, and where they live now:
 * the accounts and the departments are sections of People. The old
 * addresses redirect there.
 */
export const OLD_CLIENT_PAGES = {
  people: { tab: "people", section: "accounts" },
  departments: { tab: "people", section: "departments" },
} as const satisfies Record<string, { tab: ClientTab; section: PeopleSection }>;

export function oldClientPageTarget(clientId: string, page: keyof typeof OLD_CLIENT_PAGES): string {
  const to = OLD_CLIENT_PAGES[page];
  return clientTabHref(clientId, to.tab, to.section);
}
