import "server-only";
import { eq, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { actions, clientReviewSettings, organizations, user } from "@/db/schema";
import { assertAllowed, authorize, canTransition, ForbiddenError, type Principal, type Resource } from "@/authz";
import type { SecondReviewReason, SecondReviewRule } from "@/lib/second-review";
import { BadRequestError, NotFoundError } from "@/server/errors";
import { audit } from "./audit";
import { loadAction, roundSubmitters } from "./actions";
import { isOverdue, listActions } from "./queries";

export interface SecondReviewState {
  required: boolean;
  reason: SecondReviewReason | null;
  /** The client's rule; null on an internal project. */
  rule: SecondReviewRule | null;
  /** The action's own switch is on. */
  flagged: boolean;
  /** Revision rounds since the action was released or last reopened. */
  revisions: number;
  /** The first sign-off of the round under review. */
  signoff: { userId: string; name: string | null; at: Date } | null;
}

/** Whether an action needs a second sign-off and who gave the first. Null when the caller cannot open its project. */
export async function secondReviewState(tx: Tx, actionId: string): Promise<SecondReviewState | null> {
  const { rows } = await tx.execute<{
    required: boolean;
    reason: SecondReviewReason | null;
    rule: SecondReviewRule | null;
    flagged: boolean;
    revisions: number;
    signed_by: string | null;
    signed_by_name: string | null;
    signed_at: Date | string | null;
  }>(sql`select * from app_second_review_state(${actionId}::uuid)`);
  const r = rows[0];
  if (!r) return null;
  return {
    required: r.required,
    reason: r.reason,
    rule: r.rule,
    flagged: r.flagged,
    revisions: Number(r.revisions),
    signoff: r.signed_by ? { userId: r.signed_by, name: r.signed_by_name, at: new Date(r.signed_at!) } : null,
  };
}

/** Who could give the second sign-off now (firm staff only; empty for anyone else). */
export async function secondReviewers(tx: Tx, actionId: string) {
  const { rows } = await tx.execute<{ user_id: string; name: string; fallback: boolean }>(
    sql`select * from app_second_reviewers(${actionId}::uuid)`,
  );
  return rows.map((r) => ({ id: r.user_id, name: r.name, fallback: r.fallback }));
}

/** May this person turn an action's own switch on or off? The database checks again (check_second_review). */
const canFlag = (principal: Principal, resource: Resource & { type: "action" }) =>
  authorize(principal, "action.second_review", resource).allowed;

const clientResource = (principal: Principal, clientOrgId: string): Resource => ({
  type: "organization",
  id: clientOrgId,
  orgId: clientOrgId,
  firmOrgId: principal.orgId,
  projectId: null,
});

/** Everything the action page needs about second sign-offs, for firm staff. */
export async function actionSecondReview(tx: Tx, principal: Principal, actionId: string) {
  const loaded = await loadAction(tx, actionId);
  if (!loaded) throw new NotFoundError("action");
  const { action, resource } = loaded;
  const state = await secondReviewState(tx, actionId);
  if (!state) throw new NotFoundError("action");
  const awaiting = action.status === "awaiting_review";
  const open = action.status !== "verified_complete" && action.status !== "closed";
  const review = awaiting
    ? canTransition(principal, resource, "awaiting_review", "verified_complete", await roundSubmitters(tx, actionId)).allowed
    : false;
  return {
    ...state,
    // Names only for the firm: a client sees that a second consultant checks it, not who.
    candidates: principal.orgKind === "firm" && awaiting && state.required ? await secondReviewers(tx, actionId) : [],
    can: {
      // The first of two: anyone who could review the round, before anyone has signed off.
      signOff: review && state.required && !state.signoff,
      // The second: anyone else who could review it.
      verify: review && (!state.required || (!!state.signoff && state.signoff.userId !== principal.userId)),
      flag: open && canFlag(principal, resource),
    },
  };
}

export type ActionSecondReview = Awaited<ReturnType<typeof actionSecondReview>>;

/**
 * The first sign-off on work that needs two. The action stays Awaiting
 * Review; whoever can give the second sign-off is told (app_sign_off).
 */
export async function signOff(tx: Tx, principal: Principal, actionId: string, note?: string) {
  const loaded = await loadAction(tx, actionId);
  if (!loaded) throw new NotFoundError("action");
  const { action, resource } = loaded;
  assertAllowed(principal, "action.read", resource);
  if (action.status !== "awaiting_review") throw new BadRequestError("only work awaiting review is signed off");
  // The same separation of duties as a review: not the owner, not a submitter of the round.
  const decision = canTransition(principal, resource, "awaiting_review", "verified_complete", await roundSubmitters(tx, actionId));
  if (!decision.allowed) throw new ForbiddenError("action.review", resource, decision.reason);
  const { rows } = await tx.execute<{ id: string }>(sql`select app_sign_off(${actionId}::uuid, ${note ?? null}) as id`);
  await audit(tx, {
    actorId: principal.userId,
    orgId: principal.orgId,
    action: "action.sign_off",
    resourceType: "action",
    resourceId: actionId,
    outcome: "allow",
  });
  return { id: rows[0]!.id };
}

/** Turn an action's own second sign-off on or off: the client's lead or deputy, an internal project's lead, or the firm admin. */
export async function setActionSecondReview(tx: Tx, principal: Principal, actionId: string, on: boolean) {
  const loaded = await loadAction(tx, actionId);
  if (!loaded) throw new NotFoundError("action");
  const { action, resource } = loaded;
  assertAllowed(principal, "action.read", resource);
  assertAllowed(principal, "action.second_review", resource);
  if (action.status === "verified_complete" || action.status === "closed") throw new BadRequestError("the action is finished");
  if (action.secondReview === on) return { on };
  await tx.update(actions).set({ secondReview: on }).where(eq(actions.id, actionId));
  await audit(tx, {
    actorId: principal.userId,
    orgId: principal.orgId,
    action: "action.second_review",
    resourceType: "action",
    resourceId: actionId,
    outcome: "allow",
    meta: { on },
  });
  return { on };
}

/** A client's rule, for the client page. Firm staff only; null for anyone else. */
export async function getClientReviewRule(tx: Tx, principal: Principal, clientOrgId: string) {
  if (principal.orgKind !== "firm") return null;
  const [row] = await tx
    .select({ rule: clientReviewSettings.rule, updatedAt: clientReviewSettings.updatedAt, updatedBy: user.name })
    .from(clientReviewSettings)
    .leftJoin(user, eq(user.id, clientReviewSettings.updatedBy))
    .where(eq(clientReviewSettings.clientOrgId, clientOrgId));
  const [org] = await tx.select({ status: organizations.status }).from(organizations).where(eq(organizations.id, clientOrgId));
  return {
    rule: (row?.rule ?? "off") as SecondReviewRule,
    updatedAt: row?.updatedAt ?? null,
    updatedBy: row?.updatedBy ?? null,
    canChange: org?.status === "active" && authorize(principal, "organization.second_review", clientResource(principal, clientOrgId)).allowed,
  };
}

/** Set a client's rule (app_set_second_review_rule checks who and when). */
export async function setClientReviewRule(tx: Tx, principal: Principal, clientOrgId: string, rule: SecondReviewRule) {
  if (principal.orgKind !== "firm") throw new NotFoundError("organization");
  assertAllowed(principal, "organization.second_review", clientResource(principal, clientOrgId));
  const { rows } = await tx.execute<{ before: SecondReviewRule }>(
    sql`select app_set_second_review_rule(${clientOrgId}::uuid, ${rule}::second_review_rule) as before`,
  );
  await audit(tx, {
    actorId: principal.userId,
    orgId: principal.orgId,
    action: "organization.second_review",
    resourceType: "organization",
    resourceId: clientOrgId,
    outcome: "allow",
    meta: { from: rows[0]!.before, to: rule },
  });
  return { rule };
}

/**
 * The firm's review queue: every action awaiting review the caller can open,
 * oldest wait first, with how long it has waited, whether it needs two
 * sign-offs and how far it has got, and whether the caller can act on it.
 */
export async function reviewQueue(tx: Tx, principal: Principal) {
  if (principal.orgKind !== "firm") return [];
  const rows = await listActions(tx, principal, { status: ["awaiting_review"] });
  if (rows.length === 0) return [];
  const { rows: states } = await tx.execute<{
    id: string;
    since: Date | string | null;
    required: boolean;
    signed_by: string | null;
    signed_by_name: string | null;
    submitted: boolean;
  }>(sql`
    select a.id, a.awaiting_review_at as since, s.required, s.signed_by, s.signed_by_name, app_submitted_this_round(a.id) as submitted
    from actions a cross join lateral app_second_review_state(a.id) s
    where a.id = any(${`{${rows.map((r) => r.id).join(",")}}`}::uuid[])`);
  const byId = new Map(states.map((s) => [s.id, s]));
  const now = Date.now();
  return rows
    .map((r) => {
      const s = byId.get(r.id);
      const since = s?.since ? new Date(s.since) : null;
      const own = r.ownerUserId === principal.userId || !!s?.submitted;
      const signedByMe = s?.signed_by === principal.userId;
      return {
        ...r,
        overdue: isOverdue(r),
        since,
        waitingDays: since ? Math.max(0, Math.floor((now - since.getTime()) / 86_400_000)) : null,
        required: !!s?.required,
        signedBy: s?.signed_by_name ?? null,
        signedByMe,
        // Nobody reviews work they own or submitted, and the first reviewer does not give the second sign-off.
        canAct: !own && !signedByMe,
      };
    })
    // Oldest first; a row without a start time goes last.
    .sort((a, b) => (a.since?.getTime() ?? Number.MAX_SAFE_INTEGER) - (b.since?.getTime() ?? Number.MAX_SAFE_INTEGER));
}

export type ReviewQueueRow = Awaited<ReturnType<typeof reviewQueue>>[number];
