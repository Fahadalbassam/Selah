import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import {
  clientContacts,
  meetingAttendees,
  meetingDecisions,
  meetingNotes,
  meetingSummaries,
  meetings,
  projects,
  user,
} from "@/db/schema";
import { assertAllowed, type Principal, type Resource } from "@/authz";
import { buildIcs } from "@/lib/ics";
import { BadRequestError, NotFoundError } from "@/server/errors";
import { audit } from "./audit";
import { loadProject } from "./staffing";

// Meetings (drizzle/0023_meetings_rules.sql). Selah records the meeting and
// links to the call; invites are .ics files. The database checks call links,
// keeps the calendar UID and sequence, decides who may attend, and keeps
// firm-private records from clients. These checks give clear errors.

type Visibility = "shared" | "firm_private";
type Kind = (typeof meetings.$inferSelect)["kind"];

async function loadMeeting(tx: Tx, principal: Principal, id: string) {
  const [m] = await tx.select().from(meetings).where(eq(meetings.id, id)).limit(1);
  if (!m) throw new NotFoundError("meeting");
  const { resource: project } = await loadProject(tx, principal, m.projectId);
  const resource: Resource = { ...project, type: "meeting", id: m.id, visibility: m.visibility, createdBy: m.organizerId };
  assertAllowed(principal, "meeting.read", resource);
  return { meeting: m, resource };
}

export interface MeetingInput {
  kind: Kind;
  title: string;
  startsAt: Date;
  endsAt: Date;
  location: "online" | "in_person" | "phone";
  joinUrl?: string | null;
  locationText?: string | null;
  spokenLang?: "ar" | "en" | "mixed";
  visibility?: Visibility;
}

export async function listMeetings(tx: Tx, principal: Principal, projectId: string) {
  const { resource } = await loadProject(tx, principal, projectId);
  assertAllowed(principal, "meeting.read", { ...resource, type: "meeting" });
  return tx
    .select({
      id: meetings.id,
      kind: meetings.kind,
      title: meetings.title,
      startsAt: meetings.startsAt,
      endsAt: meetings.endsAt,
      location: meetings.location,
      provider: meetings.provider,
      status: meetings.status,
      visibility: meetings.visibility,
    })
    .from(meetings)
    .where(eq(meetings.projectId, projectId))
    .orderBy(asc(meetings.startsAt));
}

/** Book a meeting; the organiser attends. The database writes the agenda. */
export async function bookMeeting(tx: Tx, principal: Principal, projectId: string, input: MeetingInput) {
  const { project, resource } = await loadProject(tx, principal, projectId);
  const visibility = input.visibility ?? "shared";
  assertAllowed(principal, "meeting.book", { ...resource, type: "meeting", visibility });
  if (principal.orgKind === "client" && visibility !== "shared") throw new BadRequestError("client meetings are shared");
  const id = randomUUID();
  await tx.insert(meetings).values({
    id,
    projectId,
    orgId: project.orgId,
    ...input,
    visibility,
    organizerId: principal.userId,
    icsUid: "set-by-database",
  });
  await tx.insert(meetingAttendees).values({ meetingId: id, userId: principal.userId, role: "organizer" });
  await audit(tx, {
    actorId: principal.userId,
    orgId: project.orgId,
    action: "meeting.book",
    resourceType: "meeting",
    resourceId: id,
    outcome: "allow",
  });
  return { id };
}

export async function getMeeting(tx: Tx, principal: Principal, id: string) {
  const { meeting } = await loadMeeting(tx, principal, id);
  // Contact names come through RLS: only the firm sees them.
  const attendees = await tx
    .select({
      id: meetingAttendees.id,
      userId: meetingAttendees.userId,
      contactId: meetingAttendees.contactId,
      name: sql<string | null>`coalesce(${user.name}, ${clientContacts.name})`,
      role: meetingAttendees.role,
      response: meetingAttendees.response,
    })
    .from(meetingAttendees)
    .leftJoin(user, eq(user.id, meetingAttendees.userId))
    .leftJoin(clientContacts, eq(clientContacts.id, meetingAttendees.contactId))
    .where(eq(meetingAttendees.meetingId, id))
    .orderBy(asc(meetingAttendees.createdAt));
  const decisions = await tx
    .select()
    .from(meetingDecisions)
    .where(eq(meetingDecisions.meetingId, id))
    .orderBy(asc(meetingDecisions.createdAt));
  const [summary] = await tx.select().from(meetingSummaries).where(eq(meetingSummaries.meetingId, id));
  const notes = await tx
    .select({ id: meetingNotes.id, title: meetingNotes.title, visibility: meetingNotes.visibility, heldOn: meetingNotes.heldOn })
    .from(meetingNotes)
    .where(eq(meetingNotes.meetingId, id));
  return { meeting, attendees, decisions, summary: summary ?? null, notes };
}

export async function updateMeeting(
  tx: Tx,
  principal: Principal,
  id: string,
  change: Partial<MeetingInput> & { status?: "held" | "cancelled"; transcriptConsent?: boolean },
) {
  const { meeting, resource } = await loadMeeting(tx, principal, id);
  assertAllowed(principal, "meeting.run", resource);
  const updated = await tx.update(meetings).set(change).where(eq(meetings.id, id)).returning({ sequence: meetings.icsSequence });
  if (!updated.length) throw new NotFoundError("meeting");
  await audit(tx, {
    actorId: principal.userId,
    orgId: meeting.orgId,
    action: "meeting.update",
    resourceType: "meeting",
    resourceId: id,
    outcome: "allow",
    meta: { status: change.status ?? null },
  });
  return { sequence: updated[0]!.sequence };
}

export async function addAttendee(
  tx: Tx,
  principal: Principal,
  id: string,
  input: { userId?: string; contactId?: string; optional?: boolean },
) {
  const { resource } = await loadMeeting(tx, principal, id);
  assertAllowed(principal, "meeting.run", resource);
  if (!input.userId === !input.contactId) throw new BadRequestError("give a person or a contact");
  const [row] = await tx
    .insert(meetingAttendees)
    .values({ meetingId: id, userId: input.userId, contactId: input.contactId, role: input.optional ? "optional" : "required" })
    .returning({ id: meetingAttendees.id });
  return row!;
}

export async function removeAttendee(tx: Tx, principal: Principal, id: string, attendeeId: string) {
  const { meeting, resource } = await loadMeeting(tx, principal, id);
  assertAllowed(principal, "meeting.run", resource);
  const where = and(eq(meetingAttendees.id, attendeeId), eq(meetingAttendees.meetingId, id));
  const [attendee] = await tx.select({ userId: meetingAttendees.userId }).from(meetingAttendees).where(where);
  if (!attendee) throw new NotFoundError("attendee");
  if (attendee.userId === meeting.organizerId) throw new BadRequestError("the organiser stays on the meeting");
  await tx.delete(meetingAttendees).where(where);
  return { ok: true };
}

/** An attendee's own answer to the invitation. */
export async function respond(tx: Tx, principal: Principal, id: string, response: "accepted" | "declined" | "tentative") {
  await loadMeeting(tx, principal, id);
  const updated = await tx
    .update(meetingAttendees)
    .set({ response })
    .where(and(eq(meetingAttendees.meetingId, id), eq(meetingAttendees.userId, principal.userId)))
    .returning({ id: meetingAttendees.id });
  if (!updated.length) throw new NotFoundError("invitation");
  return { ok: true };
}

/** Queue the calendar invite (or cancellation) for the attendees. */
export async function sendInvites(tx: Tx, principal: Principal, id: string) {
  const { resource } = await loadMeeting(tx, principal, id);
  assertAllowed(principal, "meeting.run", resource);
  const { rows } = await tx.execute<{ n: number }>(sql`select app_send_meeting_invites(${id}) as n`);
  return { queued: rows[0]!.n };
}

export async function recordDecision(
  tx: Tx,
  principal: Principal,
  id: string,
  input: { text: string; lang: "ar" | "en"; decidedBy?: string; supersedesId?: string; visibility?: Visibility },
) {
  const { meeting, resource } = await loadMeeting(tx, principal, id);
  assertAllowed(principal, "meeting.run", resource);
  const [row] = await tx
    .insert(meetingDecisions)
    .values({
      projectId: meeting.projectId,
      orgId: meeting.orgId,
      meetingId: id,
      ...input,
      visibility: input.visibility ?? meeting.visibility,
      createdBy: principal.userId,
    })
    .returning({ id: meetingDecisions.id });
  return row!;
}

/** Write or rewrite the summary of a held meeting. Whoever saves it confirms it. */
export async function saveSummary(
  tx: Tx,
  principal: Principal,
  id: string,
  input: { lang: "ar" | "en"; mainPointsMd: string; visibility?: Visibility },
) {
  const { meeting, resource } = await loadMeeting(tx, principal, id);
  assertAllowed(principal, "meeting.run", resource);
  const values = {
    meetingId: id,
    projectId: meeting.projectId,
    orgId: meeting.orgId,
    lang: input.lang,
    mainPointsMd: input.mainPointsMd,
    source: "manual",
    confirmedBy: principal.userId,
    visibility: input.visibility ?? "firm_private",
  };
  await tx
    .insert(meetingSummaries)
    .values(values)
    .onConflictDoUpdate({
      target: meetingSummaries.meetingId,
      set: { lang: values.lang, mainPointsMd: values.mainPointsMd, source: "manual", visibility: values.visibility },
    });
  return { ok: true };
}

/** The meeting as a calendar file, for people who can see it. */
export async function meetingIcs(tx: Tx, principal: Principal, id: string) {
  const { meeting } = await loadMeeting(tx, principal, id);
  const [organizer] = await tx.select({ name: user.name, email: user.email }).from(user).where(eq(user.id, meeting.organizerId));
  const attendees = await tx
    .select({
      name: sql<string>`coalesce(${user.name}, ${clientContacts.name}, '')`,
      email: sql<string | null>`coalesce(${user.email}, ${clientContacts.email})`,
      role: meetingAttendees.role,
      userId: meetingAttendees.userId,
    })
    .from(meetingAttendees)
    .leftJoin(user, eq(user.id, meetingAttendees.userId))
    .leftJoin(clientContacts, eq(clientContacts.id, meetingAttendees.contactId))
    .where(eq(meetingAttendees.meetingId, id));
  const ics = buildIcs({
    uid: meeting.icsUid,
    sequence: meeting.icsSequence,
    status: meeting.status,
    title: meeting.title,
    startsAt: meeting.startsAt,
    endsAt: meeting.endsAt,
    joinUrl: meeting.joinUrl,
    locationText: meeting.locationText,
    organizer: organizer ?? { name: "", email: "" },
    attendees: attendees
      .filter((a) => a.email && a.userId !== meeting.organizerId)
      .map((a) => ({ name: a.name, email: a.email!, optional: a.role === "optional" })),
    updatedAt: meeting.updatedAt,
  });
  return new Response(ics, {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": `attachment; filename="meeting-${meeting.id}.ics"`,
      "cache-control": "no-store",
    },
  });
}

// ------------------------------------------------------------- schedule

export interface ScheduleFilter {
  from: Date;
  to: Date;
  projectId?: string;
  clientId?: string;
  userId?: string;
}

/**
 * Meetings, action due dates and follow-ups between two dates. Each person
 * sees only what they can already see (v_schedule runs with their rights);
 * the filters narrow that, so an admin can look at one client, project or
 * colleague.
 */
export async function schedule(tx: Tx, principal: Principal, filter: ScheduleFilter) {
  assertAllowed(principal, "schedule.read", {
    type: "meeting",
    orgId: principal.orgId,
    firmOrgId: principal.orgKind === "firm" ? principal.orgId : undefined,
    projectId: null,
  });
  if (filter.to <= filter.from) throw new BadRequestError("the end comes after the start");
  if (filter.to.getTime() - filter.from.getTime() > 186 * 86_400_000) throw new BadRequestError("at most six months at a time");
  const { rows } = await tx.execute<{
    item_type: "meeting" | "action" | "follow_up";
    item_id: string;
    project_id: string;
    project_title: string;
    org_id: string;
    title: string;
    detail: string | null;
    starts_at: string;
    ends_at: string | null;
    all_day: boolean;
    status: string;
    visibility: Visibility;
    people: string[];
  }>(sql`
    select s.*, p.title as project_title
    from v_schedule s join ${projects} p on p.id = s.project_id
    where s.starts_at >= ${filter.from.toISOString()} and s.starts_at < ${filter.to.toISOString()}
      ${filter.projectId ? sql`and s.project_id = ${filter.projectId}` : sql``}
      ${filter.clientId ? sql`and s.org_id = ${filter.clientId}` : sql``}
      ${filter.userId ? sql`and ${filter.userId}::uuid = any (s.people)` : sql``}
    order by s.starts_at, s.title
    limit 1000`);
  return rows.map((r) => ({
    type: r.item_type,
    id: r.item_id,
    projectId: r.project_id,
    projectTitle: r.project_title,
    clientId: r.org_id,
    title: r.title,
    detail: r.detail,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    allDay: r.all_day,
    status: r.status,
    visibility: r.visibility,
    people: r.people,
  }));
}
