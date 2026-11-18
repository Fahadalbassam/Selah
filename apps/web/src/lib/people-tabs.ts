// The tab rows that took the place of sidebar sub-entries (page audit 4.1):
// Team and its Expertise on the firm side; the client's People with its
// Departments and Structure. Each tab keeps its own address (LinkTabs), so
// old links and bookmarks still open the same page.

export type FirmTeamTab = "people" | "expertise";
export type ClientPeopleTab = "people" | "departments" | "structure";

export const TEAM_TAB_HREF: Record<FirmTeamTab, string> = { people: "/team", expertise: "/team/expertise" };
export const PEOPLE_TAB_HREF: Record<ClientPeopleTab, string> = { people: "/team", departments: "/departments", structure: "/departments/structure" };

/** Firm staff: the team, and who can lead what. */
export function firmTeamTabs(): FirmTeamTab[] {
  return ["people", "expertise"];
}

/**
 * The client's People page and its tabs (client admins and managers; action
 * owners have none). The admin keeps Departments while departments are off,
 * because the switch that turns them on lives there; a manager reads them
 * (with their heads) only where they are on. The Structure appears once there
 * is a published one to read (departmentTabs() in lib/org-chart.ts decides
 * what the Departments page itself shows and where it sends a reader).
 */
export function clientPeopleTabs(input: { admin: boolean; departmentsEnabled: boolean; structure: boolean }): ClientPeopleTab[] {
  return ["people", ...(input.admin || input.departmentsEnabled ? (["departments"] as const) : []), ...(input.structure ? (["structure"] as const) : [])];
}
