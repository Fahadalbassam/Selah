import "server-only";
import { and, asc, eq, gte, inArray, ne, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { actions, deadlineChangeRequests, followUps, infoRequests, meetingAttendees, meetings } from "@/db/schema";
import { authorize, type Principal, type Resource } from "@/authz";
import { parseActionsQuery } from "@/lib/action-filters";
import { firmToday } from "@/lib/dates";
import { byWaiting, ownerGroup } from "@/lib/home";
import { actionBoard } from "./action-board";
import { audiencesForMe } from "./audience";
import { clientOverview } from "./client-overview";
import { myClientAi } from "./client-ai";
import { groupRollup, myGroups } from "./client-groups";
import { deliverablesToAnswer } from "./deliverables";
import { listSupportRequests } from "./help";
import { dataSetupStep } from "./indicator-data";
import { listIndicators } from "./indicators";
import { listInquiries } from "./inquiries";
import { isOverdue, listActions } from "./queries";
import { projectResource, readableProjects, today, type ReadableProject } from "./today";

// The home page, one per role (page audit 4.2; decision D2: Today became the
// home). Each list answers "what waits for me" and holds only what the
// reader may open: every row is read under the reader's row-level security
// and checked with authorize() the way its own page checks it, and the
// existing services are reused wherever one already reads the list. A count
// on the home is the length of the list it heads, or, for the firm's
// counters, the same rule as the Actions filter it opens.

/** How far back a decided date request still shows on its asker's home. */
export const DATE_ANSWER_DAYS = 7;

export interface HomeActionRow {
  id: string;
  title: string;
  status: string;
  dueDate: string | null;
  overdue: boolean;
  projectId: string;
  projectTitle: string;
  href: string;
  /** A date the owner asked for and nobody has answered yet (shown beside the due date). */
  dateAsked: string | null;
}

export interface HomeItem {
  id: string;
  title: string;
  projectId: string;
  projectTitle: string;
  href: string;
}

export interface HomeDocument extends HomeItem {
  /** The starting list's key, so the reader sees the title in their own language. */
  templateKey: string | null;
  dueDate: string | null;
  overdue: boolean;
}

export interface HomeDateAnswer extends HomeItem {
  approved: boolean;
  proposed: string;
  decidedAt: Date;
}

export interface HomeMeeting extends HomeItem {
  startsAt: Date;
  today: boolean;
}

export interface HomeFollowUp extends HomeItem {
  dueAt: Date | null;
  overdue: boolean;
}

export interface HomeIndicator {
  id: string;
  nameAr: string | null;
  nameEn: string | null;
  /** Within its grace days, or past them. */
  status: "due" | "missing";
  href: string;
}

const isoDate = (d: string | Date) => (typeof d === "string" ? d.slice(0, 10) : d.toISOString().slice(0, 10));

/** An action as listActions() checks it. */
function actionResource(p: ReadableProject, a: { id: string; orgId: string; createdBy: string; ownerUserId: string | null; status: string }): Resource {
  return {
    ...projectResource(p),
    type: "action",
    id: a.id,
    orgId: a.orgId,
    createdBy: a.createdBy,
    assignees: a.ownerUserId ? [a.ownerUserId] : [],
    draft: a.status === "draft",
  };
}

// ------------------------------------------------------------------ firm

/**
 * The firm home: Today's six lists (the decisions now also hold disputed
 * recommendations and projects ready for the final close), then, for the
 * firm admin, the problems clients reported; the new inquiries the reader may
 * open (all of them for the admin, the ones handed to a consultant); and the
 * counters that open the Actions filters.
 */
export async function firmHome(tx: Tx, principal: Principal, day = firmToday()) {
  const lists = await today(tx, principal, day);
  // The firm admin reads and closes what clients reported from the help page (F13).
  const reports = (await listSupportRequests(tx, principal)) ?? [];
  const inquiries = (await listInquiries(tx, principal)).filter((i) => i.status === "new");
  return {
    ...lists,
    admin: principal.role === "firm_admin",
    problems: reports.filter((r) => !r.handledAt),
    handledProblems: reports.filter((r) => r.handledAt),
    inquiries,
    counters: await firmCounters(tx, principal),
  };
}

export type FirmHome = Awaited<ReturnType<typeof firmHome>>;

/**
 * One line of counts (decision D5: counts, never a health word), read from
 * the Actions list itself (actionBoard(), the same loader as attentionCounts():
 * every action the reader may open, under row-level security, then
 * authorize()), so each number is the count of the filter it opens: late,
 * awaiting review, awaiting review longer than 7 days, blocked.
 */
export async function firmCounters(tx: Tx, principal: Principal) {
  const board = await actionBoard(tx, principal, parseActionsQuery({}));
  return {
    late: board.counts.late ?? 0,
    awaitingReview: board.counts["awaiting-review"] ?? 0,
    reviewWaiting: board.waitingLongCount,
    blocked: board.counts.blocked ?? 0,
  };
}

// ------------------------------------------------------------------ shared by client roles

/** The reader's own actions (listActions, mine only), with the date they asked for still waiting. */
async function myActions(tx: Tx, principal: Principal, projects: Map<string, ReadableProject>, day: string): Promise<HomeActionRow[]> {
  const rows = (await listActions(tx, principal, { mineOnly: true })).filter((a) => projects.has(a.projectId));
  const ids = rows.map((a) => a.id);
  const asked = ids.length
    ? await tx
        .select({ actionId: deadlineChangeRequests.actionId, proposed: deadlineChangeRequests.proposedDueDate })
        .from(deadlineChangeRequests)
        .where(and(inArray(deadlineChangeRequests.actionId, ids), eq(deadlineChangeRequests.status, "pending")))
    : [];
  const askedFor = new Map(asked.map((r) => [r.actionId, isoDate(r.proposed)]));
  return rows.map((a) => ({
    id: a.id,
    title: a.title,
    status: a.status,
    dueDate: a.dueDate,
    // A closed project's open actions were settled at closing: never late.
    overdue: projects.get(a.projectId)!.state !== "closed" && isOverdue(a, day),
    projectId: a.projectId,
    projectTitle: a.projectTitle,
    href: `/actions/${a.id}`,
    dateAsked: askedFor.get(a.id) ?? null,
  }));
}

/** Files the firm asked of the reader by name, not yet sent, on projects still open (the Requests tab's rule). */
async function documentsAskedOfMe(tx: Tx, principal: Principal, projects: Map<string, ReadableProject>, day: string): Promise<HomeDocument[]> {
  const ids = [...projects.values()].filter((p) => p.kind === "client" && p.state !== "closed").map((p) => p.id);
  if (!ids.length) return [];
  const rows = await tx
    .select({ id: infoRequests.id, title: infoRequests.title, templateKey: infoRequests.templateKey, projectId: infoRequests.projectId, orgId: infoRequests.orgId, dueDate: infoRequests.dueDate })
    .from(infoRequests)
    .where(and(eq(infoRequests.ownerUserId, principal.userId), eq(infoRequests.status, "requested"), inArray(infoRequests.projectId, ids)))
    .orderBy(sql`${infoRequests.dueDate} asc nulls last`, asc(infoRequests.createdAt));
  return rows
    .filter(
      (r) =>
        authorize(principal, "info_request.read", {
          ...projectResource(projects.get(r.projectId)!),
          type: "info_request",
          id: r.id,
          orgId: r.orgId,
          assignees: [principal.userId],
        }).allowed,
    )
    .map((r) => {
      const dueDate = r.dueDate ? isoDate(r.dueDate) : null;
      return {
        id: r.id,
        title: r.title,
        templateKey: r.templateKey,
        projectId: r.projectId,
        projectTitle: projects.get(r.projectId)!.title,
        href: `/projects/${r.projectId}?tab=files`,
        dueDate,
        overdue: dueDate !== null && dueDate < day,
      };
    });
}

/** Meetings the reader is invited to that are still to come: the ones waiting for an answer, and the next one. */
async function myMeetings(tx: Tx, principal: Principal, projects: Map<string, ReadableProject>, day: string) {
  const ids = [...projects.keys()];
  if (!ids.length) return { replies: [] as HomeMeeting[], next: null as HomeMeeting | null };
  const rows = await tx
    .select({
      id: meetings.id,
      title: meetings.title,
      startsAt: meetings.startsAt,
      projectId: meetings.projectId,
      orgId: meetings.orgId,
      organizerId: meetings.organizerId,
      visibility: meetings.visibility,
      response: meetingAttendees.response,
    })
    .from(meetings)
    .innerJoin(meetingAttendees, and(eq(meetingAttendees.meetingId, meetings.id), eq(meetingAttendees.userId, principal.userId)))
    .where(and(eq(meetings.status, "scheduled"), gte(meetings.endsAt, sql`now()`), inArray(meetings.projectId, ids)))
    .orderBy(asc(meetings.startsAt), asc(meetings.id));
  // A meeting this person is left out of is not even read (row-level security); asked again here (feature A).
  const narrowed = await audiencesForMe(
    tx,
    principal,
    "meeting",
    rows.map((m) => m.id),
  );
  const open = rows.filter(
    (m) =>
      authorize(principal, "meeting.read", {
        ...projectResource(projects.get(m.projectId)!),
        type: "meeting",
        id: m.id,
        orgId: m.orgId,
        visibility: m.visibility,
        createdBy: m.organizerId,
        audience: narrowed.get(m.id),
      }).allowed,
  );
  const item = (m: (typeof rows)[number]): HomeMeeting => ({
    id: m.id,
    title: m.title,
    projectId: m.projectId,
    projectTitle: projects.get(m.projectId)!.title,
    href: `/meetings/${m.id}`,
    startsAt: m.startsAt,
    today: firmToday(m.startsAt) === day,
  });
  // Waiting for an answer: invited and not answered yet (an organiser has nothing to answer).
  const needsAnswer = (m: (typeof rows)[number]) => m.response === "needs_action" && m.organizerId !== principal.userId;
  const nextRow = open.find((m) => !needsAnswer(m));
  return { replies: open.filter(needsAnswer).map(item), next: nextRow ? item(nextRow) : null };
}

/** Open follow-ups assigned to the reader (from meetings or actions), overdue first, as Today reads them. */
async function myFollowUps(tx: Tx, principal: Principal, projects: Map<string, ReadableProject>): Promise<HomeFollowUp[]> {
  const ids = [...projects.keys()];
  if (!ids.length) return [];
  const rows = await tx
    .select({
      id: followUps.id,
      title: followUps.title,
      dueAt: followUps.dueAt,
      projectId: followUps.projectId,
      orgId: followUps.orgId,
      meetingId: followUps.meetingId,
      actionId: followUps.actionId,
      visibility: followUps.visibility,
      createdBy: followUps.createdBy,
    })
    .from(followUps)
    .where(and(eq(followUps.assigneeUserId, principal.userId), eq(followUps.status, "open"), inArray(followUps.projectId, ids)))
    .orderBy(sql`${followUps.dueAt} asc nulls last`, asc(followUps.id));
  const now = new Date();
  return rows
    .filter(
      (f) =>
        authorize(principal, "follow_up.read", {
          ...projectResource(projects.get(f.projectId)!),
          type: "follow_up",
          id: f.id,
          orgId: f.orgId,
          visibility: f.visibility,
          createdBy: f.createdBy,
          assignees: [principal.userId],
        }).allowed,
    )
    .map((f) => ({
      id: f.id,
      title: f.title,
      projectId: f.projectId,
      projectTitle: projects.get(f.projectId)!.title,
      // Where the follow-up is shown: its meeting, else its action, else the project.
      href: f.meetingId ? `/meetings/${f.meetingId}` : f.actionId ? `/actions/${f.actionId}` : `/projects/${f.projectId}`,
      dueAt: f.dueAt,
      overdue: f.dueAt !== null && f.dueAt < now,
    }));
}

// ------------------------------------------------------------------ client admin and manager

/** Shared recommendations waiting for the company's answer, where the reader is the one who answers (app_can_respond). */
async function recommendationsToAnswer(tx: Tx, principal: Principal, projects: Map<string, ReadableProject>): Promise<HomeItem[]> {
  const ids = [...projects.values()].filter((p) => p.kind === "client" && p.state !== "closed").map((p) => p.id);
  if (!ids.length) return [];
  const { rows } = await tx.execute<{ id: string; title: string; project_id: string; org_id: string; created_by: string }>(sql`
    select r.id, r.title, r.project_id, r.org_id, r.created_by
    from unnest(${sql.param(ids)}::uuid[]) as p(id)
    cross join lateral app_recommendation_stances(p.id) s
    join recommendations r on r.id = s.recommendation_id
    where s.stance = 'awaiting' and app_can_respond(r.id)
    order by r.created_at, r.id`);
  return rows
    .filter((r) => {
      const resource: Resource = {
        ...projectResource(projects.get(r.project_id)!),
        type: "recommendation",
        id: r.id,
        orgId: r.org_id,
        visibility: "shared",
        createdBy: r.created_by,
      };
      return authorize(principal, "recommendation.read", resource).allowed && authorize(principal, "recommendation.respond", resource).allowed;
    })
    .map((r) => ({
      id: r.id,
      title: r.title,
      projectId: r.project_id,
      projectTitle: projects.get(r.project_id)!.title,
      href: `/recommendations/${r.id}`,
    }));
}

/** The reader's own date requests the firm answered in the last DATE_ANSWER_DAYS days. */
async function dateAnswers(tx: Tx, principal: Principal, projects: Map<string, ReadableProject>): Promise<HomeDateAnswer[]> {
  const ids = [...projects.keys()];
  if (!ids.length) return [];
  const rows = await tx
    .select({
      id: deadlineChangeRequests.id,
      status: deadlineChangeRequests.status,
      proposed: deadlineChangeRequests.proposedDueDate,
      decidedAt: deadlineChangeRequests.decidedAt,
      actionId: actions.id,
      title: actions.title,
      projectId: actions.projectId,
      orgId: actions.orgId,
      createdBy: actions.createdBy,
      ownerUserId: actions.ownerUserId,
      actionStatus: actions.status,
    })
    .from(deadlineChangeRequests)
    .innerJoin(actions, eq(actions.id, deadlineChangeRequests.actionId))
    .where(
      and(
        eq(deadlineChangeRequests.requestedBy, principal.userId),
        ne(deadlineChangeRequests.status, "pending"),
        gte(deadlineChangeRequests.decidedAt, sql`now() - make_interval(days => ${DATE_ANSWER_DAYS})`),
        inArray(actions.projectId, ids),
      ),
    )
    .orderBy(sql`${deadlineChangeRequests.decidedAt} desc`, asc(deadlineChangeRequests.id));
  return rows
    .filter(
      (r) =>
        authorize(
          principal,
          "action.read",
          actionResource(projects.get(r.projectId)!, { id: r.actionId, orgId: r.orgId, createdBy: r.createdBy, ownerUserId: r.ownerUserId, status: r.actionStatus }),
        ).allowed,
    )
    .map((r) => ({
      id: r.id,
      title: r.title,
      projectId: r.projectId,
      projectTitle: projects.get(r.projectId)!.title,
      href: `/actions/${r.actionId}`,
      approved: r.status === "approved",
      proposed: isoDate(r.proposed),
      decidedAt: r.decidedAt!,
    }));
}

/**
 * The client admin's and client manager's home: what waits for them, in the
 * order of page audit 4.2, then their company's progress, its indicators and
 * (for the people the firm named) the group's roll-up.
 */
export async function clientHome(tx: Tx, principal: Principal, day = firmToday()) {
  const projects = await readableProjects(tx, principal);
  const admin = principal.role === "client_admin";
  const mine = await myActions(tx, principal, projects, day);
  const meetingsFor = await myMeetings(tx, principal, projects, day);
  const indicators = await listIndicators(tx, principal, principal.orgId, { includeInactive: true, today: day }).catch(() => null);
  const ai = admin ? await myClientAi(tx, principal) : null;
  const [group] = await myGroups(tx, principal);
  return {
    answers: await recommendationsToAnswer(tx, principal, projects),
    documents: await documentsAskedOfMe(tx, principal, projects, day),
    // The firm sent the reader's evidence back: the revised file is theirs to send.
    sentBack: byWaiting(mine.filter((a) => a.status === "revision_requested" && projects.get(a.projectId)!.state !== "closed")),
    // The reader's own actions that are late or stopped (sent back ones are above).
    lateOrStopped: byWaiting(
      mine.filter(
        (a) =>
          a.status !== "revision_requested" &&
          ownerGroup(a.status) === "waiting" &&
          projects.get(a.projectId)!.state !== "closed" &&
          (a.overdue || a.status === "blocked"),
      ),
    ),
    dates: await dateAnswers(tx, principal, projects),
    replies: meetingsFor.replies,
    nextMeeting: meetingsFor.next,
    followUps: await myFollowUps(tx, principal, projects),
    indicatorsDue: indicatorsDue(indicators),
    // Deliverables handed over and waiting for this person's answer (F21).
    deliverables: await deliverablesToAnswer(tx, principal),
    // The admin's two standing questions, until answered.
    assistantOffer: ai?.canConsent === true,
    dataSetup: admin ? await dataSetupStep(tx, principal, principal.orgId) : null,
    // How it is going: as on the old overview.
    overview: await clientOverview(tx, principal, principal.orgId, day).catch(() => null),
    indicators,
    group: group ? await groupRollup(tx, principal, day) : null,
  };
}

export type ClientHome = Awaited<ReturnType<typeof clientHome>>;

/** Active indicators whose latest period waits for a value, when the reader may enter values. */
function indicatorsDue(list: Awaited<ReturnType<typeof listIndicators>> | null): HomeIndicator[] {
  if (!list?.canReport) return [];
  return list.indicators
    .filter((k) => k.active && (k.summary.current === "due" || k.summary.current === "missing"))
    .map((k) => ({ id: k.id, nameAr: k.nameAr, nameEn: k.nameEn, status: k.summary.current as "due" | "missing", href: `/indicators/${k.id}` }));
}

// ------------------------------------------------------------------ action owner

/**
 * The action owner's home: their actions in three groups, then the files
 * asked of them, their meetings and their follow-ups. Nothing else: an owner
 * reads only their own actions (decision 1b, row-level security since 0081).
 */
export async function ownerHome(tx: Tx, principal: Principal, day = firmToday()) {
  const projects = await readableProjects(tx, principal);
  const mine = await myActions(tx, principal, projects, day);
  const meetingsFor = await myMeetings(tx, principal, projects, day);
  const finished = mine
    .filter((a) => ownerGroup(a.status) === "finished")
    .sort((a, b) => (b.dueDate ?? "").localeCompare(a.dueDate ?? "") || a.id.localeCompare(b.id));
  return {
    waiting: byWaiting(mine.filter((a) => ownerGroup(a.status) === "waiting" && projects.get(a.projectId)!.state !== "closed")),
    withConsultant: byWaiting(mine.filter((a) => ownerGroup(a.status) === "withConsultant" && projects.get(a.projectId)!.state !== "closed")),
    finished,
    documents: await documentsAskedOfMe(tx, principal, projects, day),
    replies: meetingsFor.replies,
    nextMeeting: meetingsFor.next,
    followUps: await myFollowUps(tx, principal, projects),
  };
}

export type OwnerHome = Awaited<ReturnType<typeof ownerHome>>;

/** The reader's home, by role. */
export async function home(tx: Tx, principal: Principal, day = firmToday()) {
  if (principal.orgKind === "firm") return { kind: "firm" as const, data: await firmHome(tx, principal, day) };
  if (principal.role === "action_owner") return { kind: "owner" as const, data: await ownerHome(tx, principal, day) };
  return { kind: "client" as const, data: await clientHome(tx, principal, day) };
}
