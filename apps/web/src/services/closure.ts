import "server-only";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import {
  clientContacts,
  orgMemberships,
  projectClosureItems,
  projectClosureLessons,
  projectClosureRequests,
  projectClosures,
  user,
} from "@/db/schema";
import { assertAllowed, authorize, type Principal } from "@/authz";
import type { BlockerKind, Disposition } from "@/lib/closure";
import { NotFoundError } from "@/server/errors";
import { audit } from "./audit";
import { sponsorOf } from "./client-roles";
import { listActions } from "./queries";
import { loadProject } from "./staffing";

// Closing a project (full picture item 25, journey J12.3-J12.4, gaps N5 and
// N9). The database holds every rule (baseline: Closing, 0020): who closes,
// what must be settled first, and that a closed project is read-only. These
// calls check the same permissions first, so the screen only offers what
// the database will take, and they write the audit trail.

const FINISHED = new Set(["verified_complete", "closed"]);

async function bool(tx: Tx, query: ReturnType<typeof sql>): Promise<boolean> {
  const { rows } = await tx.execute<{ ok: boolean }>(query);
  return rows[0]?.ok === true;
}

async function logged(tx: Tx, principal: Principal, action: string, projectId: string, meta?: Record<string, string>) {
  await audit(tx, { actorId: principal.userId, orgId: principal.orgId, action, resourceType: "project", resourceId: projectId, outcome: "allow", meta });
}

/** Everything the Closing tab shows, for whoever is looking. */
export async function getClosure(tx: Tx, principal: Principal, projectId: string) {
  const { project, resource } = await loadProject(tx, principal, projectId);
  const firm = principal.orgKind === "firm";
  const state = project.state;
  const closing = state === "closing";

  const rounds = await tx
    .select({
      id: projectClosures.id,
      startedAt: projectClosures.startedAt,
      startedBy: projectClosures.startedBy,
      closedAt: projectClosures.closedAt,
      closedBy: projectClosures.closedBy,
      cancelledAt: projectClosures.cancelledAt,
      reopenedAt: projectClosures.reopenedAt,
      reopenedBy: projectClosures.reopenedBy,
      reopenReason: projectClosures.reopenReason,
    })
    .from(projectClosures)
    .where(eq(projectClosures.projectId, projectId))
    .orderBy(desc(projectClosures.startedAt));
  const names = new Map<string, string>();
  const peopleIds = [...new Set(rounds.flatMap((r) => [r.startedBy, r.closedBy, r.reopenedBy]).filter((x): x is string => !!x))];
  if (peopleIds.length) for (const u of await tx.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, peopleIds))) names.set(u.id, u.name);
  const current = rounds.find((r) => !r.cancelledAt && !r.reopenedAt) ?? null;

  // The open actions this user can read, each with its disposition in this round.
  const open = current ? (await listActions(tx, principal, { projectId })).filter((a) => !FINISHED.has(a.status)) : [];
  const items = current
    ? await tx
        .select({
          actionId: projectClosureItems.actionId,
          disposition: projectClosureItems.disposition,
          note: projectClosureItems.note,
          sustainerUserId: projectClosureItems.sustainerUserId,
          sustainerContactId: projectClosureItems.sustainerContactId,
          sustainerName: sql<string | null>`coalesce(${user.name}, ${clientContacts.name})`,
        })
        .from(projectClosureItems)
        .leftJoin(user, eq(user.id, projectClosureItems.sustainerUserId))
        .leftJoin(clientContacts, eq(clientContacts.id, projectClosureItems.sustainerContactId))
        .where(eq(projectClosureItems.closureId, current.id))
    : [];
  const byAction = new Map(items.map((i) => [i.actionId, i]));

  const blockers: { kind: BlockerKind; actionId: string | null }[] =
    firm && closing
      ? (await tx.execute<{ kind: BlockerKind; action_id: string | null }>(sql`select * from app_closure_blockers(${projectId})`)).rows.map((r) => ({
          kind: r.kind,
          actionId: r.action_id,
        }))
      : [];

  const [lessons] =
    firm && current
      ? await tx
          .select({ wentWell: projectClosureLessons.wentWell, toImprove: projectClosureLessons.toImprove, nextTime: projectClosureLessons.nextTime })
          .from(projectClosureLessons)
          .where(eq(projectClosureLessons.closureId, current.id))
      : [];

  const [request] = await tx
    .select({
      id: projectClosureRequests.id,
      status: projectClosureRequests.status,
      note: projectClosureRequests.note,
      reply: projectClosureRequests.reply,
      createdAt: projectClosureRequests.createdAt,
      decidedAt: projectClosureRequests.decidedAt,
      requestedBy: user.name,
    })
    .from(projectClosureRequests)
    .leftJoin(user, eq(user.id, projectClosureRequests.requestedBy))
    .where(eq(projectClosureRequests.projectId, projectId))
    .orderBy(desc(projectClosureRequests.createdAt))
    .limit(1);

  const sponsor = project.kind === "client" ? await sponsorOf(tx, projectId) : null;
  const canClose = authorize(principal, "project.close", resource).allowed && (await bool(tx, sql`select app_can_close_project(${projectId}) as ok`));
  // The client's lead or deputy opens and stops the gate; the admin closes (0058).
  const canStart =
    canClose ||
    (authorize(principal, "project.start_closing", resource).allowed && (await bool(tx, sql`select app_can_start_closing(${projectId}) as ok`)));
  const canDispose = closing && authorize(principal, "closure.dispose", resource).allowed;
  // The client's admin, or the project's sponsor (app_name_sustainer).
  const canName =
    closing &&
    authorize(principal, "closure.sustainer", resource).allowed &&
    (firm || principal.role === "client_admin" || (sponsor !== null && sponsor.id === principal.userId));
  const canRequest =
    (state === "planned" || state === "active") &&
    request?.status !== "pending" &&
    authorize(principal, "closure.request", resource).allowed &&
    (await bool(tx, sql`select app_can_request_closure(${projectId}) as ok`));

  // Whom a handed-over action can go to: the active accounts of the project's
  // organisation, and for the firm its contacts there too.
  const people = canName
    ? await tx
        .select({ id: user.id, name: user.name })
        .from(orgMemberships)
        .innerJoin(user, eq(user.id, orgMemberships.userId))
        .where(and(eq(orgMemberships.orgId, project.orgId), eq(orgMemberships.active, true)))
        .orderBy(asc(user.name))
    : [];
  const contacts =
    canName && firm && project.kind === "client"
      ? await tx
          .select({ id: clientContacts.id, name: clientContacts.name })
          .from(clientContacts)
          .where(eq(clientContacts.orgId, project.orgId))
          .orderBy(asc(clientContacts.name))
      : [];

  return {
    kind: project.kind,
    state,
    /** The firm's view (blockers, lessons, every decision) or the client's. */
    firm,
    current: current
      ? {
          startedAt: current.startedAt,
          startedBy: current.startedBy ? (names.get(current.startedBy) ?? null) : null,
          closedAt: current.closedAt,
          closedBy: current.closedBy ? (names.get(current.closedBy) ?? null) : null,
        }
      : null,
    // Earlier rounds: closings that were cancelled, and closings that were reopened and why.
    history: rounds
      .filter((r) => r !== current)
      .map((r) => ({
        startedAt: r.startedAt,
        cancelledAt: r.cancelledAt,
        closedAt: r.closedAt,
        reopenedAt: r.reopenedAt,
        reopenedBy: r.reopenedBy ? (names.get(r.reopenedBy) ?? null) : null,
        reopenReason: r.reopenReason,
      })),
    items: open.map((a) => {
      const i = byAction.get(a.id);
      return {
        actionId: a.id,
        title: a.title,
        status: a.status,
        owner: a.ownerName,
        recommendation: a.recommendationTitle,
        disposition: (i?.disposition ?? null) as Disposition | null,
        note: i?.note ?? null,
        sustainer: i && (i.sustainerUserId || i.sustainerContactId)
          ? { userId: i.sustainerUserId, contactId: i.sustainerContactId, name: i.sustainerName }
          : null,
      };
    }),
    blockers,
    lessons: firm ? (lessons ?? null) : null,
    request: request ?? null,
    people,
    contacts,
    can: {
      start: canStart && (state === "planned" || state === "active"),
      cancel: canStart && closing,
      close: canClose && closing,
      reopen: state === "closed" && authorize(principal, "project.reopen", resource).allowed,
      dispose: canDispose,
      lessons: closing && authorize(principal, "closure.lessons", resource).allowed,
      nameSustainer: canName,
      request: canRequest,
      decline: canClose && request?.status === "pending",
    },
  };
}

export type ClosureView = Awaited<ReturnType<typeof getClosure>>;

/** Start, cancel, finish or reopen closing. */
export async function moveClosure(
  tx: Tx,
  principal: Principal,
  projectId: string,
  input: { step: "start" | "cancel" | "close" } | { step: "reopen"; reason: string },
) {
  const { resource } = await loadProject(tx, principal, projectId);
  if (input.step === "reopen") {
    assertAllowed(principal, "project.reopen", resource);
    await tx.execute(sql`select app_reopen_project(${projectId}, ${input.reason})`);
    await logged(tx, principal, "project.reopen", projectId, { reason: input.reason.slice(0, 200) });
  } else {
    assertAllowed(principal, input.step === "close" ? "project.close" : "project.start_closing", resource);
    if (input.step === "start") await tx.execute(sql`select app_start_closing(${projectId})`);
    if (input.step === "cancel") await tx.execute(sql`select app_cancel_closing(${projectId})`);
    if (input.step === "close") await tx.execute(sql`select app_close_project(${projectId})`);
    await logged(tx, principal, input.step === "close" ? "project.close" : `project.closing_${input.step}`, projectId);
  }
  return getClosure(tx, principal, projectId);
}

async function loadOpenAction(tx: Tx, principal: Principal, projectId: string, actionId: string) {
  const { resource } = await loadProject(tx, principal, projectId);
  const [row] = (await listActions(tx, principal, { projectId })).filter((a) => a.id === actionId);
  if (!row) throw new NotFoundError("action");
  return resource;
}

/** The firm decides what happens to one open action (or clears it, with disposition null). */
export async function disposeAction(
  tx: Tx,
  principal: Principal,
  projectId: string,
  actionId: string,
  input: { disposition: Disposition | null; note?: string | null; sustainerUserId?: string | null; sustainerContactId?: string | null },
) {
  const resource = await loadOpenAction(tx, principal, projectId, actionId);
  assertAllowed(principal, "closure.dispose", resource);
  if (input.disposition === null) {
    await tx.execute(sql`select app_clear_disposition(${actionId})`);
  } else {
    await tx.execute(
      sql`select app_dispose_action(${actionId}, ${input.disposition}::closure_disposition, ${input.note ?? null}, ${input.sustainerUserId ?? null}::uuid, ${input.sustainerContactId ?? null}::uuid)`,
    );
  }
  await logged(tx, principal, "closure.dispose", projectId, { actionId, disposition: input.disposition ?? "cleared" });
  return getClosure(tx, principal, projectId);
}

/** Name who sustains a handed-over action: the firm, the client's admin or the sponsor. */
export async function nameSustainer(
  tx: Tx,
  principal: Principal,
  projectId: string,
  actionId: string,
  input: { sustainerUserId?: string | null; sustainerContactId?: string | null },
) {
  const resource = await loadOpenAction(tx, principal, projectId, actionId);
  assertAllowed(principal, "closure.sustainer", resource);
  await tx.execute(sql`select app_name_sustainer(${actionId}, ${input.sustainerUserId ?? null}::uuid, ${input.sustainerContactId ?? null}::uuid)`);
  await logged(tx, principal, "closure.sustainer", projectId, { actionId });
  return getClosure(tx, principal, projectId);
}

/** The firm's lessons for this closing round. */
export async function writeLessons(tx: Tx, principal: Principal, projectId: string, input: { wentWell: string; toImprove: string; nextTime?: string | null }) {
  const { resource } = await loadProject(tx, principal, projectId);
  assertAllowed(principal, "closure.lessons", resource);
  await tx.execute(sql`select app_write_lessons(${projectId}, ${input.wentWell}, ${input.toImprove}, ${input.nextTime ?? null})`);
  await logged(tx, principal, "closure.lessons", projectId);
  return getClosure(tx, principal, projectId);
}

/** The client's sponsor or admin asks the firm to close (N9). */
export async function requestClosure(tx: Tx, principal: Principal, projectId: string, input: { note?: string | null }) {
  const { resource } = await loadProject(tx, principal, projectId);
  assertAllowed(principal, "closure.request", resource);
  await tx.execute(sql`select app_request_closure(${projectId}, ${input.note ?? null})`);
  await logged(tx, principal, "closure.request", projectId);
  return getClosure(tx, principal, projectId);
}

/** The firm admin declines the client's request, saying why. */
export async function declineClosureRequest(tx: Tx, principal: Principal, projectId: string, requestId: string, input: { reply: string }) {
  const { resource } = await loadProject(tx, principal, projectId);
  assertAllowed(principal, "project.close", resource);
  const [req] = await tx
    .select({ id: projectClosureRequests.id })
    .from(projectClosureRequests)
    .where(and(eq(projectClosureRequests.id, requestId), eq(projectClosureRequests.projectId, projectId)));
  if (!req) throw new NotFoundError("request");
  await tx.execute(sql`select app_decline_closure_request(${requestId}, ${input.reply})`);
  await logged(tx, principal, "closure.decline", projectId);
  return getClosure(tx, principal, projectId);
}
