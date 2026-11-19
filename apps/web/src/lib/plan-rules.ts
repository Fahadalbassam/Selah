// The rule chips on a project's Plan (page audit 4.3: "Needs attention: six
// rules" plus Oversight's two). Plain module shared by the service, the page
// and the tests. Each chip filters the plan in place, with its count; the
// count is worked out from the same rows as the Actions list, so the chip
// "late 3" and /actions?filter=late&project=… hold the same three actions.

import type { RuleFilterKey } from "@/lib/action-filters";

export const PLAN_RULES = ["late", "blocked", "no-activity", "date-moved", "sent-back", "no-owner", "waiting-long", "disputed"] as const;
export type PlanRule = (typeof PLAN_RULES)[number];

/** The rules of an action (the rest: a review waiting long is an action too; disputed is a recommendation). */
export const ACTION_RULES = ["late", "blocked", "no-activity", "date-moved", "sent-back", "no-owner"] as const satisfies readonly RuleFilterKey[];

/**
 * The chips a reader is offered. Late and blocked are anyone's; the firm's
 * working measures (no activity, date moved, sent back, no active owner, a
 * review waiting long, a recommendation in dispute) are the firm's, as on the
 * Actions page (policy "deviation.read"; batch 1 keeps them off client screens).
 */
export function planRulesFor(firm: boolean): PlanRule[] {
  return firm ? [...PLAN_RULES] : ["late", "blocked"];
}

/** The chip asked for in the address, if the reader is offered it. */
export function parsePlanRule(v: string | string[] | undefined, firm: boolean): PlanRule | null {
  const s = Array.isArray(v) ? v[0] : v;
  return planRulesFor(firm).find((r) => r === s) ?? null;
}
