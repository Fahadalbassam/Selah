// The Actions page's filters (page audit 4.6, decision D2): one list at
// /actions, its filter in the address so the home, the Projects table and old
// links can point at it. Plain module: the page, the service, the home and the
// tests share the names and the addresses.
//
//   /actions?filter=late&project=<id>
//   /actions?filter=awaiting-review&waiting=long
//
// What each filter means is decided in services/action-board.ts, from rows the
// reader may open (row-level security, then authorize()).

import { REVIEW_WAIT_DAYS } from "@/lib/health";

export const ACTION_FILTERS = [
  "all",
  "mine",
  "awaiting-review",
  "late",
  "blocked",
  "no-activity",
  "date-moved",
  "sent-back",
  "no-owner",
] as const;
export type ActionFilterKey = (typeof ACTION_FILTERS)[number];

/** The rules an open action can break. Their lists carry "Remind the owner" for the firm. */
export const RULE_FILTERS = ["late", "blocked", "no-activity", "date-moved", "sent-back", "no-owner"] as const satisfies readonly ActionFilterKey[];
export type RuleFilterKey = (typeof RULE_FILTERS)[number];

/**
 * The firm's working measures (the deviation rules, policy "deviation.read"):
 * no activity, a date moved twice, sent back twice, no active owner. A client
 * reader is not offered them; batch 1 keeps date moves and revisions off client screens.
 */
export const FIRM_RULE_FILTERS = ["no-activity", "date-moved", "sent-back", "no-owner"] as const satisfies readonly RuleFilterKey[];

/** The deviation rule (v_deviations) behind each firm filter. */
export const DEVIATION_RULE: Record<(typeof FIRM_RULE_FILTERS)[number], "stale" | "slipped" | "churn" | "orphaned"> = {
  "no-activity": "stale",
  "date-moved": "slipped",
  "sent-back": "churn",
  "no-owner": "orphaned",
};

export interface ActionsReader {
  firm: boolean;
  /** An action owner reads only their own actions, so "mine" is the whole list. */
  actionOwner: boolean;
}

/** The filters a reader is offered, in the order the page shows them. */
export function filtersFor(reader: ActionsReader): ActionFilterKey[] {
  if (reader.firm) return [...ACTION_FILTERS];
  const client: ActionFilterKey[] = ["all", "mine", "awaiting-review", "late", "blocked"];
  return reader.actionOwner ? client.filter((f) => f !== "mine") : client;
}

export const isRuleFilter = (f: ActionFilterKey): f is RuleFilterKey => (RULE_FILTERS as readonly string[]).includes(f);

/** What the address asks for. Ids are checked as uuids; anything else is dropped, never passed on. */
export interface ActionsQuery {
  filter: ActionFilterKey;
  /** Only with "awaiting-review": the reviews that have waited longer than REVIEW_WAIT_DAYS days. */
  waitingLong: boolean;
  client?: string;
  project?: string;
  owner?: string;
  department?: string;
  page: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const id = (v: string | string[] | undefined) => {
  const s = one(v);
  return s && UUID.test(s) ? s.toLowerCase() : undefined;
};

/** Read the page's address. An unknown filter is "all"; a filter the reader is not offered becomes "all" in the service. */
export function parseActionsQuery(params: Record<string, string | string[] | undefined>): ActionsQuery {
  const f = one(params.filter);
  const filter = (ACTION_FILTERS as readonly string[]).includes(f ?? "") ? (f as ActionFilterKey) : "all";
  const n = Number(one(params.page));
  return {
    filter,
    waitingLong: filter === "awaiting-review" && one(params.waiting) === "long",
    client: id(params.client),
    project: id(params.project),
    owner: id(params.owner),
    department: id(params.department),
    page: Number.isInteger(n) && n >= 1 && n <= 10_000 ? n : 1,
  };
}

/** The address of a filtered list. Defaults are left out, so `/actions` is the whole list. */
export function actionsHref(q: Partial<ActionsQuery> = {}): string {
  const p = new URLSearchParams();
  if (q.filter && q.filter !== "all") p.set("filter", q.filter);
  if (q.waitingLong && q.filter === "awaiting-review") p.set("waiting", "long");
  if (q.client) p.set("client", q.client);
  if (q.project) p.set("project", q.project);
  if (q.owner) p.set("owner", q.owner);
  if (q.department) p.set("department", q.department);
  if (q.page && q.page > 1) p.set("page", String(q.page));
  const s = p.toString();
  return s ? `/actions?${s}` : "/actions";
}

/** The two counts that were Oversight's neutral tiles, as the home links to them (D5: counts, no health word). */
export const LATE_HREF = actionsHref({ filter: "late" });
export const REVIEWS_WAITING_LONG_HREF = actionsHref({ filter: "awaiting-review", waitingLong: true });

/** A review has waited "long" past this many whole days (lib/health.ts, the same 7 days the database uses). */
export const REVIEW_LONG_DAYS = REVIEW_WAIT_DAYS;
