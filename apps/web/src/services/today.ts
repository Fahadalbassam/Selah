import "server-only";
import { and, asc, eq, gte, inArray, isNull, lt, lte, ne, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Tx } from "@/db/client";
import {
  actions,
  deadlineChangeRequests,
  followUps,
  infoRequests,
  joinRequests,
  meetings,
  organizations,
  projectClosureRequests,
  projects,
  recommendations,
  user,
  watches,
} from "@/db/schema";
import { authorize, canTransition, OPEN_STATUSES, type ActionStatus, type Principal, type Resource } from "@/authz";
import { firmToday } from "@/lib/dates";
import { NotFoundError } from "@/server/errors";

// A firm person's day across every client (Wave 3, research section 7):
// what waits for their review, what falls due where they lead, their own
// follow-ups and meetings, and the decisions waiting on them. Nothing is
// stored; it is a query. Every row comes through RLS and is then checked
// with authorize() (or canTransition() for reviews), so the page never shows
// something the person could not already open.
//
// "Mine" is narrower than "may see": a consultant's projects are the ones
// they are staffed on (and every project of a client they lead or deputise
// on, as authorize() already allows). The firm admin may see everything, so
// for them it is the projects they are staffed on or lead, and the clients
// and projects they watch. Join requests and clients' closure requests are
// decided by the admin alone and come from every client.

/** Where an item belongs on the page: a client, or the firm's internal projects. */
export interface TodayGroup {
  /** The client's id; the firm's own id for internal projects. */
  id: string;
  internal: boolean;
  name: string;
  nameAr: string | null;
}

interface Item {
  id: string;
  group: TodayGroup;
  projectId: string;
  projectTitle: string;
  title: string;
  href: string;
}

export interface ReviewItem extends Item {
  ownerName: string | null;
  /** When it entered Awaiting Review. */
  since: Date | null;
}

export interface DueItem extends Item {
  status: ActionStatus;
  dueDate: string;
  overdue: boolean;
  ownerName: string | null;
}

export interface FollowUpItem extends Item {
  dueAt: Date | null;
  overdue: boolean;
}

export interface MeetingItem extends Item {
  startsAt: Date;
  endsAt: Date;
  today: boolean;
  hasAgenda: boolean;
  organizer: boolean;
}

export interface DecisionItem extends Omit<Item, "projectId" | "projectTitle"> {
  kind: "join_request" | "deadline_request" | "closure_request" | "info_request";
  projectId: string | null;
  projectTitle: string | null;
  /** Who asked (join, deadline and closure requests). */
  who: string | null;
  /** The proposed due date of a deadline change. */
  proposed: string | null;
  at: Date;
}

export interface VisitItem {
  group: TodayGroup;
  projectId: string;
  projectTitle: string;
  changed: number;
  /** Never opened: the count covers the last 7 days, as on the project page. */
  firstVisit: boolean;
}

export interface Today {
  today: string;
  reviews: ReviewItem[];
  due: DueItem[];
  followUps: FollowUpItem[];
  meetings: MeetingItem[];
  decisions: DecisionItem[];
  visits: VisitItem[];
}

/** How far ahead "due soon" and "this week" look. */
export const TODAY_WINDOW_DAYS = 7;

function addDays(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const isoDate = (d: string | Date) => (typeof d === "string" ? d.slice(0, 10) : d.toISOString().slice(0, 10));

export async function today(tx: Tx, principal: Principal, day = firmToday()): Promise<Today> {
  if (principal.orgKind !== "firm") throw new NotFoundError("page");
  const admin = principal.role === "firm_admin";
  const soon = addDays(day, TODAY_WINDOW_DAYS);

  // Every project this person can open (RLS, then authorize()), with what the checks need.
  const projectRows = await tx
    .select({
      id: projects.id,
      kind: projects.kind,
      title: projects.title,
      state: projects.state,
      orgId: projects.orgId,
      firmOrgId: projects.firmOrgId,
      orgName: organizations.name,
      orgNameAr: organizations.nameAr,
      engagementMode: organizations.engagementMode,
    })
    .from(projects)
    .innerJoin(organizations, eq(organizations.id, projects.orgId));
  const resourceOf = (p: (typeof projectRows)[number]): Resource => ({
    type: "project",
    id: p.id,
    orgId: p.orgId,
    firmOrgId: p.firmOrgId,
    projectId: p.id,
    projectKind: p.kind,
    projectState: p.state,
    engagementMode: p.kind === "client" ? p.engagementMode : null,
    clientOrgId: p.kind === "client" ? p.orgId : undefined,
  });
  const byId = new Map(projectRows.filter((p) => authorize(principal, "project.read", resourceOf(p)).allowed).map((p) => [p.id, p]));

  const watched = admin
    ? await tx.select({ clientOrgId: watches.clientOrgId, projectId: watches.projectId }).from(watches).where(eq(watches.userId, principal.userId))
    : [];
  const watchedClients = new Set(watched.flatMap((w) => (w.clientOrgId ? [w.clientOrgId] : [])));
  const watchedProjects = new Set(watched.flatMap((w) => (w.projectId ? [w.projectId] : [])));

  /** Projects the person works on. */
  const staffed = (p: (typeof projectRows)[number]) =>
    admin
      ? principal.projectIds.has(p.id) || watchedProjects.has(p.id) || watchedClients.has(p.orgId)
      : principal.projectIds.has(p.id) || (p.kind === "client" && principal.leadClientIds.has(p.orgId));
  /** Projects the person answers for: as the client's lead or deputy, or the internal project's lead. */
  const leads = (p: (typeof projectRows)[number]) =>
    admin
      ? staffed(p)
      : principal.leadProjectIds.has(p.id) || (p.kind === "client" && principal.leadClientIds.has(p.orgId));

  const mine = [...byId.values()].filter(staffed);
  const mineIds = mine.map((p) => p.id);
  const leadIds = mine.filter(leads).map((p) => p.id);
  const allIds = [...byId.keys()];

  const groupOf = (p: { kind: string; orgId: string; orgName: string; orgNameAr: string | null }): TodayGroup => ({
    id: p.orgId,
    internal: p.kind === "internal",
    name: p.orgName,
    nameAr: p.orgNameAr,
  });
  const at = (projectId: string) => {
    const p = byId.get(projectId)!;
    return { group: groupOf(p), projectId, projectTitle: p.title };
  };

  const owner = alias(user, "owner");
  const actionColumns = {
    id: actions.id,
    title: actions.title,
    status: actions.status,
    dueDate: actions.dueDate,
    projectId: actions.projectId,
    orgId: actions.orgId,
    ownerUserId: actions.ownerUserId,
    ownerName: sql<string | null>`coalesce(${owner.name}, ${actions.ownerName})`,
    createdBy: actions.createdBy,
    awaitingReviewAt: actions.awaitingReviewAt,
    label: recommendations.visibility,
  };
  type ActionRow = { id: string; projectId: string; orgId: string; ownerUserId: string | null; createdBy: string; label: Resource["visibility"] };
  const actionResource = (a: ActionRow): Resource & { type: "action" } => {
    const p = byId.get(a.projectId)!;
    return {
      ...resourceOf(p),
      type: "action",
      id: a.id,
      orgId: a.orgId,
      createdBy: a.createdBy,
      assignees: a.ownerUserId ? [a.ownerUserId] : [],
      // An action takes its recommendation's label (0006).
      visibility: a.label,
    };
  };

  // 1. Waiting for my review. Nobody reviews work they own or submitted in
  // this round (workflow.ts), so the round's submitters come along.
  const reviewRows = mineIds.length
    ? await tx
        .select({
          ...actionColumns,
          iSubmitted: sql<boolean>`(
            exists (select 1 from evidence_submissions es where es.action_id = ${actions.id} and es.submitted_by = ${principal.userId}::uuid
              and es.created_at > coalesce((select max(r.created_at) from reviews r where r.action_id = ${actions.id}), '-infinity'))
            or exists (select 1 from progress_updates pu where pu.action_id = ${actions.id} and pu.author_id = ${principal.userId}::uuid
              and pu.source = 'consultant_recorded'
              and pu.created_at > coalesce((select max(r.created_at) from reviews r where r.action_id = ${actions.id}), '-infinity'))
          )`,
        })
        .from(actions)
        .innerJoin(recommendations, eq(recommendations.id, actions.recommendationId))
        .leftJoin(owner, eq(owner.id, actions.ownerUserId))
        .where(and(eq(actions.status, "awaiting_review"), inArray(actions.projectId, mineIds)))
        .orderBy(sql`${actions.awaitingReviewAt} asc nulls last`, asc(actions.id))
    : [];
  const reviews: ReviewItem[] = reviewRows
    .filter((a) =>
      canTransition(principal, actionResource(a), "awaiting_review", "verified_complete", a.iSubmitted ? [principal.userId] : []).allowed,
    )
    .map((a) => ({
      id: a.id,
      ...at(a.projectId),
      title: a.title,
      href: `/actions/${a.id}`,
      ownerName: a.ownerName,
      since: a.awaitingReviewAt,
    }));
  const inReview = new Set(reviews.map((r) => r.id));

  // 2. Overdue or due within the week, where I lead, and my own actions.
  // A closed project's open actions were settled at closing.
  const openIds = [...byId.values()].filter((p) => p.state !== "closed").map((p) => p.id);
  const dueRows = openIds.length
    ? await tx
        .select(actionColumns)
        .from(actions)
        .innerJoin(recommendations, eq(recommendations.id, actions.recommendationId))
        .leftJoin(owner, eq(owner.id, actions.ownerUserId))
        .where(
          and(
            inArray(actions.status, [...OPEN_STATUSES]),
            isNull(actions.closureOutcome),
            lte(actions.dueDate, soon),
            inArray(actions.projectId, openIds),
            or(leadIds.length ? inArray(actions.projectId, leadIds) : sql`false`, eq(actions.ownerUserId, principal.userId)),
          ),
        )
        .orderBy(asc(actions.dueDate), asc(actions.id))
    : [];
  const due: DueItem[] = dueRows
    .filter((a) => !inReview.has(a.id) && authorize(principal, "action.read", actionResource(a)).allowed)
    .map((a) => {
      const dueDate = isoDate(a.dueDate!);
      return {
        id: a.id,
        ...at(a.projectId),
        title: a.title,
        href: `/actions/${a.id}`,
        status: a.status as ActionStatus,
        dueDate,
        overdue: dueDate < day,
        ownerName: a.ownerName,
      };
    });

  // 3. Follow-ups I own, overdue first. Check-ins go on after a project closes.
  const now = new Date();
  const followRows = allIds.length
    ? await tx
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
          assigneeUserId: followUps.assigneeUserId,
        })
        .from(followUps)
        .where(and(eq(followUps.assigneeUserId, principal.userId), eq(followUps.status, "open"), inArray(followUps.projectId, allIds)))
        .orderBy(sql`${followUps.dueAt} asc nulls last`, asc(followUps.id))
    : [];
  const followList: FollowUpItem[] = followRows
    .filter(
      (f) =>
        authorize(principal, "follow_up.read", {
          ...resourceOf(byId.get(f.projectId)!),
          type: "follow_up",
          id: f.id,
          orgId: f.orgId,
          visibility: f.visibility,
          createdBy: f.createdBy,
          assignees: f.assigneeUserId ? [f.assigneeUserId] : [],
        }).allowed,
    )
    .map((f) => ({
      id: f.id,
      ...at(f.projectId),
      title: f.title,
      // Where the follow-up is shown: its meeting, else its action, else the project.
      href: f.meetingId ? `/meetings/${f.meetingId}` : f.actionId ? `/actions/${f.actionId}` : `/projects/${f.projectId}`,
      dueAt: f.dueAt,
      overdue: f.dueAt !== null && f.dueAt < now,
    }));

  // 4. Meetings today and this week that I organise or attend.
  const from = sql`(${day}::date)::timestamp at time zone app_firm_tz()`;
  const to = sql`(${soon}::date)::timestamp at time zone app_firm_tz()`;
  const meetingRows = allIds.length
    ? await tx
        .select({
          id: meetings.id,
          title: meetings.title,
          startsAt: meetings.startsAt,
          endsAt: meetings.endsAt,
          projectId: meetings.projectId,
          orgId: meetings.orgId,
          organizerId: meetings.organizerId,
          visibility: meetings.visibility,
          hasAgenda: sql<boolean>`coalesce(length(btrim(${meetings.agendaMd})), 0) > 0`,
        })
        .from(meetings)
        .where(
          and(
            ne(meetings.status, "cancelled"),
            gte(meetings.startsAt, from),
            lt(meetings.startsAt, to),
            inArray(meetings.projectId, allIds),
            or(
              eq(meetings.organizerId, principal.userId),
              sql`exists (select 1 from meeting_attendees ma where ma.meeting_id = ${meetings.id} and ma.user_id = ${principal.userId}::uuid)`,
            ),
          ),
        )
        .orderBy(asc(meetings.startsAt), asc(meetings.id))
    : [];
  const meetingList: MeetingItem[] = meetingRows
    .filter(
      (m) =>
        authorize(principal, "meeting.read", {
          ...resourceOf(byId.get(m.projectId)!),
          type: "meeting",
          id: m.id,
          orgId: m.orgId,
          visibility: m.visibility,
          createdBy: m.organizerId,
        }).allowed,
    )
    .map((m) => ({
      id: m.id,
      ...at(m.projectId),
      title: m.title,
      href: `/meetings/${m.id}`,
      startsAt: m.startsAt,
      endsAt: m.endsAt,
      today: firmToday(m.startsAt) === day,
      hasAgenda: m.hasAgenda,
      organizer: m.organizerId === principal.userId,
    }));

  // 5. Decisions waiting on me as a lead or the admin.
  const decisions: DecisionItem[] = [];

  // Join requests: the admin, or the client's lead (or deputy).
  const requester = alias(user, "requester");
  const joins = await tx
    .select({
      id: joinRequests.id,
      clientOrgId: joinRequests.clientOrgId,
      userId: joinRequests.userId,
      createdAt: joinRequests.createdAt,
      who: requester.name,
      orgName: organizations.name,
      orgNameAr: organizations.nameAr,
    })
    .from(joinRequests)
    .innerJoin(organizations, eq(organizations.id, joinRequests.clientOrgId))
    .leftJoin(requester, eq(requester.id, joinRequests.userId))
    .where(eq(joinRequests.status, "pending"))
    .orderBy(asc(joinRequests.createdAt));
  for (const j of joins) {
    const resource: Resource = { type: "join_request", orgId: principal.orgId, firmOrgId: principal.orgId, projectId: null, clientOrgId: j.clientOrgId, createdBy: j.userId };
    if (!authorize(principal, "join_request.decide", resource).allowed) continue;
    decisions.push({
      kind: "join_request",
      id: j.id,
      group: { id: j.clientOrgId, internal: false, name: j.orgName, nameAr: j.orgNameAr },
      projectId: null,
      projectTitle: null,
      title: j.orgName,
      href: `/clients/${j.clientOrgId}`,
      who: j.who,
      proposed: null,
      at: j.createdAt,
    });
  }

  // Deadline changes on projects I lead, not ones I asked for myself.
  const deadlineRows = leadIds.length
    ? await tx
        .select({
          requestId: deadlineChangeRequests.id,
          proposed: deadlineChangeRequests.proposedDueDate,
          requestedBy: deadlineChangeRequests.requestedBy,
          createdAt: deadlineChangeRequests.createdAt,
          who: requester.name,
          ...actionColumns,
        })
        .from(deadlineChangeRequests)
        .innerJoin(actions, eq(actions.id, deadlineChangeRequests.actionId))
        .innerJoin(recommendations, eq(recommendations.id, actions.recommendationId))
        .leftJoin(owner, eq(owner.id, actions.ownerUserId))
        .leftJoin(requester, eq(requester.id, deadlineChangeRequests.requestedBy))
        .where(
          and(
            eq(deadlineChangeRequests.status, "pending"),
            ne(deadlineChangeRequests.requestedBy, principal.userId),
            inArray(deadlineChangeRequests.projectId, leadIds),
          ),
        )
        .orderBy(asc(deadlineChangeRequests.createdAt))
    : [];
  for (const d of deadlineRows) {
    if (!authorize(principal, "deadline_request.decide", { ...actionResource(d), type: "deadline_request" }).allowed) continue;
    decisions.push({
      kind: "deadline_request",
      id: d.requestId,
      ...at(d.projectId),
      title: d.title,
      href: `/actions/${d.id}`,
      who: d.who,
      proposed: isoDate(d.proposed),
      at: d.createdAt,
    });
  }

  // A client asking the firm to close a project: the admin decides.
  const closureRows = allIds.length
    ? await tx
        .select({
          id: projectClosureRequests.id,
          projectId: projectClosureRequests.projectId,
          createdAt: projectClosureRequests.createdAt,
          who: requester.name,
        })
        .from(projectClosureRequests)
        .leftJoin(requester, eq(requester.id, projectClosureRequests.requestedBy))
        .where(and(eq(projectClosureRequests.status, "pending"), inArray(projectClosureRequests.projectId, allIds)))
        .orderBy(asc(projectClosureRequests.createdAt))
    : [];
  for (const c of closureRows) {
    if (!authorize(principal, "project.close", resourceOf(byId.get(c.projectId)!)).allowed) continue;
    decisions.push({
      kind: "closure_request",
      id: c.id,
      ...at(c.projectId),
      title: byId.get(c.projectId)!.title,
      href: `/projects/${c.projectId}?tab=closing`,
      who: c.who,
      proposed: null,
      at: c.createdAt,
    });
  }

  // Request-list items the client answered, waiting for the firm to look.
  const infoRows = mineIds.length
    ? await tx
        .select({
          id: infoRequests.id,
          title: infoRequests.title,
          projectId: infoRequests.projectId,
          orgId: infoRequests.orgId,
          ownerUserId: infoRequests.ownerUserId,
          at: sql<Date>`coalesce(${infoRequests.statusAt}, ${infoRequests.updatedAt})`.mapWith((v) => new Date(v)),
        })
        .from(infoRequests)
        .where(and(eq(infoRequests.status, "received"), inArray(infoRequests.projectId, mineIds)))
        .orderBy(asc(infoRequests.updatedAt))
    : [];
  for (const r of infoRows) {
    const resource: Resource = {
      ...resourceOf(byId.get(r.projectId)!),
      type: "info_request",
      id: r.id,
      orgId: r.orgId,
      assignees: r.ownerUserId ? [r.ownerUserId] : [],
    };
    if (!authorize(principal, "info_request.manage", resource).allowed) continue;
    decisions.push({
      kind: "info_request",
      id: r.id,
      ...at(r.projectId),
      title: r.title,
      href: `/projects/${r.projectId}?tab=requests`,
      who: null,
      proposed: null,
      at: r.at,
    });
  }
  decisions.sort((a, b) => a.at.getTime() - b.at.getTime());

  // 6. What moved since I last opened each of my open projects (the project
  // page's rule: app_changed_actions, the last 7 days before a first visit).
  const visitIds = mine.filter((p) => p.state !== "closed").map((p) => p.id);
  const { rows: visitRows } = visitIds.length
    ? await tx.execute<{ project_id: string; changed: number; first_visit: boolean }>(sql`
        select p.id as project_id, v.last_seen_at is null as first_visit,
          (select count(*)::int from app_changed_actions(p.id, coalesce(v.last_seen_at, now() - interval '7 days'))) as changed
        from unnest(${sql.param(visitIds)}::uuid[]) as p(id)
        left join project_visits v on v.project_id = p.id and v.user_id = ${principal.userId}::uuid`)
    : { rows: [] };
  const visits: VisitItem[] = visitRows
    .filter((v) => Number(v.changed) > 0)
    .map((v) => ({ ...at(v.project_id), changed: Number(v.changed), firstVisit: v.first_visit }))
    .sort((a, b) => b.changed - a.changed || a.projectTitle.localeCompare(b.projectTitle));

  return { today: day, reviews, due, followUps: followList, meetings: meetingList, decisions, visits };
}
