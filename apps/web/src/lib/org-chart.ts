// The client's organisation structure (org chart, migration 0091). Shared by
// the schema, the services, the screens and the tests; the database holds the
// same lists and limits (the org_unit_kind enum, the check constraints on
// org_units, positions, position_holders and org_chart_change_requests), and
// tests/db/org-chart.test.ts proves the two agree.
//
// Selah records the structure the firm decides; it never designs, scores or
// judges one. The chart never grants or limits access to any work: the
// client's departments stay the only rule for that.

/** What a unit is, from the board down to an office. */
export const ORG_UNIT_KINDS = ["board", "committee", "executive", "sector", "department", "section", "unit", "office"] as const;
export type OrgUnitKind = (typeof ORG_UNIT_KINDS)[number];

/** A version is the firm's draft, the current published structure, or history. */
export const ORG_CHART_STATES = ["draft", "published", "superseded"] as const;
export type OrgChartState = (typeof ORG_CHART_STATES)[number];

/** A client admin's "suggest a change": open until the firm marks it done or declined. */
export const ORG_CHART_REQUEST_STATUSES = ["open", "done", "declined"] as const;
export type OrgChartRequestStatus = (typeof ORG_CHART_REQUEST_STATUSES)[number];

/** Codes such as 2.4 (a unit) and 2.4.1 (a position): Latin letters and digits, dots and dashes. */
export const ORG_CODE = /^[0-9A-Za-z][0-9A-Za-z.-]{0,39}$/;

export const ORG_CHART_LIMITS = {
  /** Unit names and position titles, in each language. */
  name: 200,
  /** Levels run from 1 (the board or the top) down. */
  level: { min: 1, max: 12 },
  /** How many people a position is planned for. */
  planned: { min: 1, max: 999 },
  /** Specialties of a position: how many, and how long each. */
  specialties: { count: 30, length: 100 },
  /** A typed holder name. */
  holderName: { min: 2, max: 200 },
  /** "Suggest a change": what (required), where and why. */
  request: { what: { min: 3, max: 1000 }, where: 300, why: 1000 },
} as const;

/**
 * The tabs of the client's Departments page for a reader (client admins and
 * managers): Structure once there is a structure to read. When the company
 * does not use departments, a manager sees only the Structure, since the
 * Departments tab holds nothing for her; the client admin keeps both,
 * because the switch that turns departments on lives on the Departments tab.
 */
export function departmentTabs(input: { admin: boolean; departmentsEnabled: boolean; structure: boolean }): ("departments" | "structure")[] {
  if (!input.structure) return ["departments"];
  if (!input.departmentsEnabled && !input.admin) return ["structure"];
  return ["departments", "structure"];
}

/** What a version is on a day, for the words on the Structure tab and the PDF. */
export type VersionStatus =
  | { kind: "draft" }
  /** In effect today; `until` and `by` when a later version, already published, takes effect on a coming day. */
  | { kind: "current"; until?: string; by?: number }
  /** Published, but its day has not come yet. */
  | { kind: "upcoming"; on: string }
  /** Replaced: the day the version that replaced it took effect, and its number. */
  | { kind: "past"; replacedOn: string; by: number };

/**
 * What a version is on a day (YYYY-MM-DD). The version in effect is the
 * latest published one whose effective day has come; a version published to
 * take effect later is "upcoming", and the one it replaces stays current
 * until that day. A version is replaced on the day a later one took effect.
 */
export function versionStatus(
  v: { id: string; state: OrgChartState; number: number | null; effectiveOn: string | null },
  all: readonly { id: string; state: OrgChartState; number: number | null; effectiveOn: string | null }[],
  today: string,
): VersionStatus {
  if (v.state === "draft" || v.number === null) return { kind: "draft" };
  const dated = all
    .filter((x): x is typeof x & { number: number; effectiveOn: string } => x.state !== "draft" && x.number !== null && x.effectiveOn !== null)
    .sort((a, b) => a.number - b.number);
  const inEffect = dated.filter((x) => x.effectiveOn <= today).at(-1);
  const later = dated.filter((x) => x.number > v.number!);
  if (inEffect?.id === v.id) {
    const next = later[0];
    return next ? { kind: "current", until: next.effectiveOn, by: next.number } : { kind: "current" };
  }
  if (!inEffect || v.number > inEffect.number) return { kind: "upcoming", on: v.effectiveOn ?? today };
  // Replaced by the first later version that has taken effect.
  const by = later.find((x) => x.effectiveOn <= today) ?? later[0]!;
  return { kind: "past", replacedOn: by.effectiveOn, by: by.number };
}

/**
 * The message key (under orgChart.errors) for a refusal the database words in English, so a
 * screen can show it in the reader's language; null for anything else.
 */
export function orgChartError(message: string | undefined): string | null {
  if (!message) return null;
  // The services' own refusals (BadRequestError) carry a key.
  if ((ORG_CHART_ERROR_KEYS as readonly string[]).includes(message)) return message;
  const rules: [RegExp, string][] = [
    [/this draft is no longer the current one/, "draftChanged"],
    [/already holds the position on some of those days/, "alreadyHolds"],
    [/a holder is one of the client's own active people/, "ownPeople"],
    [/a holding ends on or after the day it started/, "endBefore"],
    [/this holding has already ended/, "alreadyEnded"],
    [/nothing is published yet to start again from/, "nothingPublished"],
    [/cannot report to itself|cannot sit under itself/, "cycle"],
    [/move or remove the units and positions inside this unit first/, "not_empty"],
    [/a published structure never changes/, "published"],
    [/never in the draft/, "draft"],
    [/a position only the draft has holds someone/, "draftOnlyHeld"],
    [/minimal records/, "minimal_records"],
  ];
  return rules.find(([re]) => re.test(message))?.[1] ?? null;
}

/** The keys the org chart services refuse with (BadRequestError), each with a sentence under orgChart.errors. */
export const ORG_CHART_ERROR_KEYS = [
  "name",
  "name_length",
  "code",
  "code_taken",
  "level",
  "department",
  "cycle",
  "not_empty",
  "specialties",
  "planned",
  "holder",
  "holder_name",
  "overlap",
  "date",
  "published",
  "draft",
  "history",
  "minimal_records",
  "position",
  "replacement",
] as const;

/** Specialties as the database keeps them: trimmed, without blanks or repeats, in the order given. */
export function cleanSpecialties(list: readonly string[]): string[] {
  const out: string[] = [];
  for (const s of list) {
    const t = s.trim();
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

/**
 * The next free child code under a parent code ("2.4" gives "2.4.1", "2.4.2"...),
 * or a top-level number. Null when the parent's code is too long to extend.
 */
export function nextCode(parent: string | null, taken: ReadonlySet<string>): string | null {
  for (let n = 1; n < 10_000; n++) {
    const code = parent ? `${parent}.${n}` : String(n);
    if (!ORG_CODE.test(code)) return null;
    if (!taken.has(code)) return code;
  }
  return null;
}
