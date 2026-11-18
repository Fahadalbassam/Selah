// Dense rows (page audit U15, batch 1): a row shows one main button, and the
// rest of what may be done to it sits in a row menu (⋯). Both are built only
// from the permissions the server sent for that row, so moving a button into
// the menu never offers it to someone new and never takes it from anyone.
// tests/row-actions.test.ts checks every combination.

/** What a row shows: its one main button (or none) and the items of its menu, in order. */
export interface RowPlan<K extends string> {
  main: K | null;
  menu: K[];
}

/**
 * The first allowed key of `order.main` becomes the button; every other
 * allowed key of `order.menu` goes in the menu. A key missing from both
 * lists is never shown, so each list must name everything the row offers.
 */
export function rowPlan<K extends string>(allowed: Record<K, boolean>, order: { main: readonly K[]; menu: readonly K[] }): RowPlan<K> {
  const main = order.main.find((k) => allowed[k]) ?? null;
  return { main, menu: order.menu.filter((k) => allowed[k] && k !== main) };
}

/**
 * A document request (the project's Requests tab). The firm's main step is
 * accepting the file it was sent; the client's is sending one. Everything
 * else (another file, a no-login link, returning it, "does not apply",
 * editing, removing, stopping a link) is rare and goes in the menu.
 */
export const REQUEST_ROW = {
  main: ["review", "answer"],
  menu: ["answer", "sendLink", "revokeLink", "returnIt", "reopen", "notApplicable", "edit", "remove"],
} as const;
export type RequestRowKey = (typeof REQUEST_ROW.menu)[number] | (typeof REQUEST_ROW.main)[number];
export const requestRowPlan = (can: Record<RequestRowKey, boolean>) => rowPlan(can, REQUEST_ROW);

/** A department card: adding a person is its button; renaming, moving its work and switching it off or on are in its menu. */
export const DEPARTMENT_CARD = { main: ["addPerson"], menu: ["rename", "moveWork", "switchOff", "switchOn"] } as const;
export type DepartmentCardKey = (typeof DEPARTMENT_CARD.main)[number] | (typeof DEPARTMENT_CARD.menu)[number];
export const departmentCardPlan = (can: Record<DepartmentCardKey, boolean>) => rowPlan(can, DEPARTMENT_CARD);

/** A person in a department: no button, a menu to make them head (or not) and to take them out. */
export const MEMBER_ROW = { main: [], menu: ["makeHead", "notHead", "remove"] } as const;
export type MemberRowKey = (typeof MEMBER_ROW.menu)[number];
export const memberRowPlan = (can: Record<MemberRowKey, boolean>) => rowPlan<MemberRowKey>(can, MEMBER_ROW);

/** A value of a business indicator, one row of a table: no button; marking it checked and correcting it are in the menu (page audit row 28). */
export const VALUE_ROW = { main: [], menu: ["check", "correct"] } as const;
export type ValueRowKey = (typeof VALUE_ROW.menu)[number];
export const valueRowPlan = (can: Record<ValueRowKey, boolean>) => rowPlan<ValueRowKey>(can, VALUE_ROW);

/** A consultant on the firm's client page: no button; lead, deputy and taking them off the team are in the menu. */
export const TEAM_ROW = { main: [], menu: ["makeLead", "makeDeputy", "removeDeputy", "remove"] } as const;
export type TeamRowKey = (typeof TEAM_ROW.menu)[number];
export const teamRowPlan = (can: Record<TeamRowKey, boolean>) => rowPlan<TeamRowKey>(can, TEAM_ROW);
