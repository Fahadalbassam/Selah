// The client's organisation structure (org chart, migration 0100). Shared by
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
 * The message key (under orgChart.errors) for a refusal the database words in English, so a
 * screen can show it in the reader's language; null for anything else.
 */
export function orgChartError(message: string | undefined): string | null {
  if (!message) return null;
  const rules: [RegExp, string][] = [[/this draft is no longer the current one/, "draftChanged"]];
  return rules.find(([re]) => re.test(message))?.[1] ?? null;
}

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
