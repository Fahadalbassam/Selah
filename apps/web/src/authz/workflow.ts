import { authorize } from "./authorize";
import type { Permission } from "./policy";
import type { Decision, Principal, Resource } from "./types";

export type ActionStatus =
  | "draft"
  | "assigned"
  | "in_progress"
  | "blocked"
  | "awaiting_review"
  | "revision_requested"
  | "verified_complete";

/**
 * Every allowed status move and the permission it needs. The database trigger
 * check_action_transition() holds the same list of moves, so a move missing
 * here is also rejected by Postgres.
 *
 * Only action.review (firm staff) can leave Awaiting Review, and only that
 * path reaches Verified Complete. A client's claim never counts as verified.
 */
export const TRANSITIONS: Readonly<Record<string, Permission>> = {
  "draft>assigned": "action.release",
  "assigned>in_progress": "action.work",
  "in_progress>blocked": "action.work",
  "blocked>in_progress": "action.work",
  "in_progress>awaiting_review": "action.work",
  "revision_requested>in_progress": "action.work",
  "awaiting_review>verified_complete": "action.review",
  "awaiting_review>revision_requested": "action.review",
};

export function transitionPermission(from: ActionStatus, to: ActionStatus): Permission | undefined {
  return TRANSITIONS[`${from}>${to}`];
}

/** Can this user move this action from its current status to `to`? */
export function canTransition(
  principal: Principal,
  action: Resource & { type: "action" },
  from: ActionStatus,
  to: ActionStatus,
): Decision {
  const permission = transitionPermission(from, to);
  if (!permission) return { allowed: false, reason: `workflow:${from}>${to}` };
  return authorize(principal, permission, action);
}
