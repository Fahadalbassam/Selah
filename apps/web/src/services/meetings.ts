import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, eq, getTableColumns, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Tx } from "@/db/client";
import {
  clientContacts,
  departments,
  followUps,
  meetingAttendees,
  meetingDecisions,
  meetingNotes,
  meetingSummaries,
  meetingSummarySources,
  meetingTranscripts,
  documents,
  meetings,
  organizations,
  projects,
  user,
} from "@/db/schema";
import { assertAllowed, authorize, type Principal, type Resource } from "@/authz";
import { buildIcs } from "@/lib/ics";
import type { SpokenLang } from "@/lib/meetings";
import { parseTranscript, TRANSCRIPT_MAX_CHARS, type TranscriptFormat } from "@/lib/transcripts";
import { BadRequestError, NotFoundError } from "@/server/errors";
import { audit } from "./audit";
import { audienceOf, audiencesForMe, readAudience, writeAudience, type AudienceInput } from "./audience";
import { loadProject } from "./staffing";

// Meetings (baseline: Meetings). Selah records the meeting and
// links to the call; invites are .ics files. The database checks call links,
// keeps the calendar UID and sequence, decides who may attend, and keeps
// firm-private records from clients. These checks give clear errors.

type Visibility = "shared" | "firm_private";
type Kind = (typeof meetings.$inferSelect)["kind"];

// Every column but the stored agenda: the app role cannot read that one from
// the table (migration 0072). It comes from app_meeting_agenda_for(), which
// gives it only to a reader who may open every action it names.
const { agendaMd: _agendaColumn, ...meetingColumns } = getTableColumns(meetings);
void _agendaColumn;

export async function loadMeeting(tx: Tx, principal: Principal, id: string) {
  const [m] = await tx.select(meetingColumns).from(meetings).where(eq(meetings.id, id)).limit(1);
  if (!m) throw new NotFoundError("meeting");
  const { resource: project } = await loadProject(tx, principal, m.projectId);
  // Whose meeting it is (feature A): the client's own when a client person booked it.
  const { rows } = await tx.execute<{ side: string | null }>(sql`select app_audience_side('meeting', ${id}::uuid) as side`);
  const resource: Resource = {
    ...project,
    type: "meeting",
    id: m.id,
    visibility: m.visibility,
    createdBy: m.organizerId,
    ownerOrgId: rows[0]?.side === "client" ? project.orgId : project.firmOrgId,
    audience: await audienceOf(tx, principal, "meeting", m.id),
  };
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
  spokenLang?: SpokenLang;
  visibility?: Visibility;
  /** A department's meeting (set when booking; the database writes its agenda). */
  departmentId?: string;
}

export async function listMeetings(tx: Tx, principal: Principal, projectId: string) {
  const { resource } = await loadProject(tx, principal, projectId);
  assertAllowed(principal, "meeting.read", { ...resource, type: "meeting" });
  // Row-level security already leaves out a meeting this person is left out
  // of; the ones still listed say when they were narrowed ("Limited audience").
  const rows = await tx
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
  const narrowed = await audiencesForMe(
    tx,
    principal,
    "meeting",
    rows.map((r) => r.id),
  );
  return rows.map((r) => ({ ...r, limited: narrowed.has(r.id) }));
}

export interface Invitee {
  userId?: string;
  contactId?: string;
  optional?: boolean;
}

/**
 * Book a meeting with its attendees in one go; the organiser attends. The
 * database writes the agenda and checks every attendee. With `sendInvites`
 * the calendar invite is queued for everyone with an address.
 */
export async function bookMeeting(
  tx: Tx,
  principal: Principal,
  projectId: string,
  {
    attendees = [],
    sendInvites: send = false,
    audience,
    ...input
  }: MeetingInput & { attendees?: Invitee[]; sendInvites?: boolean; audience?: AudienceInput | null },
) {
  const { project, resource } = await loadProject(tx, principal, projectId);
  const visibility = input.visibility ?? "shared";
  assertAllowed(principal, "meeting.book", { ...resource, type: "meeting", visibility });
  if (principal.orgKind === "client" && visibility !== "shared") throw new BadRequestError("client meetings are shared");
  if (input.departmentId) {
    const [d] = await tx
      .select({ id: departments.id })
      .from(departments)
      .where(and(eq(departments.id, input.departmentId), eq(departments.orgId, project.orgId), eq(departments.active, true)));
    if (!d) throw new BadRequestError("that department is not an active department of this client");
    // A department's meeting carries that department's agenda, so it is booked
    // by people who see its work: the firm, the client's admin, its own people.
    const { rows } = await tx.execute<{ ok: boolean }>(sql`select app_dept_ok(${input.departmentId}::uuid, ${project.orgId}::uuid) as ok`);
    if (!rows[0]?.ok) throw new BadRequestError("book a department's meeting for a department you are in");
  } else if (!(await readsWholeProject(tx, projectId))) {
    // A whole-project meeting opens only for people who may see all of the
    // project's work (decision 1a); its organiser too. The database refuses the
    // same (policy whole_project on meetings).
    throw new BadRequestError("book a meeting for one of your departments: a whole-project meeting is for people who see all of the project's work");
  }
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
  const others = attendees.filter((a) => a.userId !== principal.userId);
  for (const a of others) {
    if (!a.userId === !a.contactId) throw new BadRequestError("give a person or a contact");
    if (a.contactId && principal.orgKind !== "firm") throw new BadRequestError("contacts are invited by the firm");
  }
  if (others.length) {
    await tx
      .insert(meetingAttendees)
      .values(
        others.map(
          (a) =>
            ({ meetingId: id, userId: a.userId, contactId: a.contactId, role: a.optional ? "optional" : "required" }) as const,
        ),
      );
  }
  await audit(tx, {
    actorId: principal.userId,
    orgId: project.orgId,
    action: "meeting.book",
    resourceType: "meeting",
    resourceId: id,
    outcome: "allow",
  });
  // Who sees it, chosen while booking (feature A): set before any invite is
  // queued, so nobody left out is ever sent one.
  if (audience && audience.mode !== "everyone") {
    const { resource: booked } = await loadMeeting(tx, principal, id);
    await writeAudience(tx, principal, "meeting", id, booked, audience, { on: "book" });
  }
  if (!send) return { id, queued: 0 };
  const { rows } = await tx.execute<{ n: number }>(sql`select app_send_meeting_invites(${id}) as n`);
  return { id, queued: rows[0]!.n };
}

/**
 * Whether the caller may see everything on the project, and so open and book
 * a meeting of the whole project (decision 1a): firm staff on it, the client's
 * admin, a client manager in every department (or with departments off).
 * Stable: it never moves when work is released (migration 0084).
 */
async function readsWholeProject(tx: Tx, projectId: string) {
  const { rows } = await tx.execute<{ ok: boolean }>(sql`select app_sees_whole_project(${projectId}::uuid) as ok`);
  return rows[0]?.ok === true;
}

/**
 * Whom the user can invite to a meeting on the project: people with an
 * account who can open it and, for the firm, the client's contacts. For each
 * person, whether they could open a meeting of the whole project, and their
 * departments: the booking form warns before saving when someone could not
 * (decision 1a). With the departments the caller may book a meeting for, and
 * whether they may book one for the whole project.
 */
export async function meetingInvitees(tx: Tx, principal: Principal, projectId: string) {
  const { project, resource } = await loadProject(tx, principal, projectId);
  assertAllowed(principal, "meeting.book", { ...resource, type: "meeting", visibility: "shared" });
  const { rows } = await tx.execute<{ user_id: string; name: string; firm: boolean; whole_project: boolean; departments: string[] }>(
    sql`select * from app_meeting_invitees(${projectId})`,
  );
  // The user themselves included: they can be assigned a follow-up.
  const people = rows.map((r) => ({
    userId: r.user_id,
    name: r.name,
    firm: r.firm,
    wholeProject: r.whole_project,
    departmentIds: r.departments ?? [],
  }));
  // The client's departments the caller may book a meeting for (the firm and
  // the client's admin: all of them; a manager: her own). Row-level security
  // and the department check decide, as when booking.
  const bookable =
    project.kind === "client"
      ? await tx
          .select({ id: departments.id, nameAr: departments.nameAr, nameEn: departments.nameEn })
          .from(departments)
          .innerJoin(organizations, eq(organizations.id, departments.orgId))
          .where(
            and(
              eq(departments.orgId, project.orgId),
              eq(departments.active, true),
              eq(organizations.departmentsEnabled, true),
              sql`app_dept_ok(${departments.id}, ${departments.orgId})`,
            ),
          )
          .orderBy(asc(departments.nameAr))
      : [];
  // Only the firm keeps the contact list (RLS returns nothing to anyone else).
  const contacts =
    principal.orgKind === "firm" && project.kind === "client"
      ? await tx
          .select({
            contactId: clientContacts.id,
            name: clientContacts.name,
            title: clientContacts.title,
            hasEmail: sql<boolean>`${clientContacts.email} is not null`,
          })
          .from(clientContacts)
          .where(eq(clientContacts.orgId, project.orgId))
          .orderBy(asc(clientContacts.name))
      : [];
  return {
    people,
    contacts,
    departments: bookable,
    wholeProject: await readsWholeProject(tx, projectId),
    // The booker may choose who sees the meeting (feature A): firm staff, and the client's admin.
    audience: authorize(principal, "meeting.audience", { ...resource, type: "meeting", visibility: "shared", ownerOrgId: principal.orgId }).allowed,
  };
}

export async function getMeeting(tx: Tx, principal: Principal, id: string) {
  const { meeting, resource } = await loadMeeting(tx, principal, id);
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
  const [summary] = await tx
    .select({ ...getTableColumns(meetingSummaries), confirmedByName: user.name })
    .from(meetingSummaries)
    .leftJoin(user, eq(user.id, meetingSummaries.confirmedBy))
    .where(eq(meetingSummaries.meetingId, id));
  const notes = await tx
    .select({ id: meetingNotes.id, title: meetingNotes.title, visibility: meetingNotes.visibility, heldOn: meetingNotes.heldOn })
    .from(meetingNotes)
    .where(eq(meetingNotes.meetingId, id));
  // Firm staff running the meeting see whether a transcript is kept, and until when (RLS hides it from everyone else).
  const [transcript] = await tx
    .select({
      lang: meetingTranscripts.lang,
      format: meetingTranscripts.format,
      chars: sql<number>`length(${meetingTranscripts.body})`.mapWith(Number),
      importedAt: meetingTranscripts.importedAt,
      deleteAfter: meetingTranscripts.deleteAfter,
      importedBy: user.name,
    })
    .from(meetingTranscripts)
    .leftJoin(user, eq(user.id, meetingTranscripts.importedBy))
    .where(eq(meetingTranscripts.meetingId, id));
  const assignee = alias(user, "assignee");
  const follow = await tx
    .select({
      id: followUps.id,
      title: followUps.title,
      dueAt: followUps.dueAt,
      status: followUps.status,
      visibility: followUps.visibility,
      decisionId: followUps.meetingDecisionId,
      assigneeUserId: followUps.assigneeUserId,
      assignee: assignee.name,
    })
    .from(followUps)
    .leftJoin(assignee, eq(assignee.id, followUps.assigneeUserId))
    .where(eq(followUps.meetingId, id))
    .orderBy(asc(followUps.createdAt));
  // An observer reads the meeting and changes nothing: the database refuses
  // every write of theirs here (migration 0034), so no control is offered.
  const observing = principal.observedProjectIds?.has(meeting.projectId) ?? false;
  const canRun = !observing && (principal.orgKind === "firm" || meeting.organizerId === principal.userId);
  // The stored agenda names the project's late, waiting and blocked actions,
  // as they stood at booking. Only a reader who may see everything on the
  // project gets that text; everyone else gets the same lists built now from
  // the actions they can read (an action owner: her own), so the text never
  // leaves the database for them (decision 1a, the lead's ruling, 0085).
  const { rows: agendaRows } = await tx.execute<{ agenda: string | null; live: boolean }>(
    sql`select agenda, live from app_meeting_agenda_for(${id}::uuid)`,
  );
  const agendaScope: "all" | "own" | "readable" = !agendaRows[0]?.live ? "all" : principal.role === "action_owner" ? "own" : "readable";
  const sources = summary ? await summarySources(tx, id) : [];
  // Files a summary line can cite: this project's, as row-level security shows them to firm staff who run it.
  const sourceFiles =
    summary && canRun && principal.orgKind === "firm"
      ? await tx
          .select({ id: documents.id, title: documents.title, version: documents.version })
          .from(documents)
          .where(
            and(
              eq(documents.projectId, meeting.projectId),
              sql`not exists (select 1 from documents n where n.supersedes_id = ${documents.id})`,
            ),
          )
          .orderBy(asc(documents.title))
      : [];
  return {
    meeting: { ...meeting, agendaMd: agendaRows[0]?.agenda ?? null },
    /** "all": the stored agenda; "own": built from the reader's own actions; "readable": from the work they can open. */
    agendaScope,
    attendees,
    decisions,
    followUps: follow,
    summary: summary ?? null,
    sources,
    sourceFiles,
    notes,
    transcript: transcript ?? null,
    canRun,
    canFollowUp: principal.orgKind === "firm" && !observing,
    // An invited observer cannot answer either (the attendee table is read-only to them).
    canRespond: !observing,
    me: principal.userId,
    // Who sees it (feature A): narrowed ("Limited audience", for the people who still see it),
    // and whether this person may change it (firm staff on the firm's meeting, the client's admin on the client's).
    limited: Boolean(resource.audience),
    canAudience: authorize(principal, "meeting.audience", resource).allowed,
  };
}

// ------------------------------------------------- summary line sources

const EXCERPT_CHARS = 400;

/**
 * Where each summary line came from, as the caller may see it: row-level
 * security keeps transcript passages to the firm and file pages to people
 * who can open the file.
 */
async function summarySources(tx: Tx, meetingId: string) {
  const rows = await tx
    .select({
      id: meetingSummarySources.id,
      line: meetingSummarySources.line,
      kind: meetingSummarySources.kind,
      transcriptStart: meetingSummarySources.transcriptStart,
      transcriptEnd: meetingSummarySources.transcriptEnd,
      documentId: meetingSummarySources.documentId,
      documentVersion: meetingSummarySources.documentVersion,
      page: meetingSummarySources.page,
      documentTitle: documents.title,
      // A newer version of the file has been uploaded since (a new row that supersedes this one).
      superseded: sql<boolean>`exists (select 1 from documents n where n.supersedes_id = ${documents.id})`,
    })
    .from(meetingSummarySources)
    .leftJoin(documents, eq(documents.id, meetingSummarySources.documentId))
    .where(eq(meetingSummarySources.meetingId, meetingId))
    .orderBy(asc(meetingSummarySources.line), asc(meetingSummarySources.kind), asc(meetingSummarySources.page));
  const needsText = rows.some((r) => r.kind === "transcript");
  const [t] = needsText
    ? await tx
        .select({ body: meetingTranscripts.body })
        .from(meetingTranscripts)
        .where(eq(meetingTranscripts.meetingId, meetingId))
    : [];
  return rows.map(({ superseded, ...r }) => ({
    ...r,
    // The passage itself, shortened; the transcript can be gone (deleted on schedule) while the pointer stays.
    excerpt:
      r.kind === "transcript" && t
        ? t.body.slice(r.transcriptStart!, Math.min(r.transcriptEnd!, r.transcriptStart! + EXCERPT_CHARS))
        : null,
    // The page was cited in an older version of the file.
    outdated: r.kind === "document" && superseded === true,
  }));
}

export type SummarySourceInput =
  | { line: number; kind: "transcript"; quote: string }
  | { line: number; kind: "document"; documentId: string; page: number };

/**
 * Point a summary line at where it came from: a passage of the transcript,
 * found by quoting it, or a page of a project file. Firm staff who run the
 * meeting; the database checks the line, the passage and the file.
 */
export async function addSummarySource(tx: Tx, principal: Principal, meetingId: string, input: SummarySourceInput) {
  const { meeting, resource } = await loadMeeting(tx, principal, meetingId);
  if (principal.orgKind !== "firm") throw new NotFoundError("meeting");
  assertAllowed(principal, "meeting.run", resource);
  const base = { meetingId, projectId: meeting.projectId, orgId: meeting.orgId, line: input.line };
  if (input.kind === "transcript") {
    const [t] = await tx
      .select({ body: meetingTranscripts.body })
      .from(meetingTranscripts)
      .where(eq(meetingTranscripts.meetingId, meetingId));
    if (!t) throw new BadRequestError("import the transcript first");
    const quote = input.quote.trim();
    const at = quote ? t.body.indexOf(quote) : -1;
    if (at < 0) throw new BadRequestError("that passage is not in the transcript; copy it exactly");
    const [row] = await tx
      .insert(meetingSummarySources)
      .values({ ...base, kind: "transcript", transcriptStart: at, transcriptEnd: at + quote.length })
      .returning({ id: meetingSummarySources.id });
    return row!;
  }
  const [row] = await tx
    .insert(meetingSummarySources)
    .values({ ...base, kind: "document", documentId: input.documentId, page: input.page })
    .returning({ id: meetingSummarySources.id });
  return row!;
}

export async function removeSummarySource(tx: Tx, principal: Principal, sourceId: string) {
  const [src] = await tx
    .select({ meetingId: meetingSummarySources.meetingId })
    .from(meetingSummarySources)
    .where(eq(meetingSummarySources.id, sourceId));
  if (!src) throw new NotFoundError("source");
  const { resource } = await loadMeeting(tx, principal, src.meetingId);
  if (principal.orgKind !== "firm") throw new NotFoundError("source");
  assertAllowed(principal, "meeting.run", resource);
  await tx.delete(meetingSummarySources).where(eq(meetingSummarySources.id, sourceId));
  return { ok: true };
}

// ---------------------------------------------------------- transcripts

async function loadForTranscript(tx: Tx, principal: Principal, id: string) {
  const loaded = await loadMeeting(tx, principal, id);
  // Firm staff only: a transcript is never shown to the client.
  if (principal.orgKind !== "firm") throw new NotFoundError("meeting");
  assertAllowed(principal, "meeting.run", loaded.resource);
  return loaded;
}

/** The transcript's text, for firm staff who run the meeting. */
export async function getTranscript(tx: Tx, principal: Principal, id: string) {
  await loadForTranscript(tx, principal, id);
  const [t] = await tx.select().from(meetingTranscripts).where(eq(meetingTranscripts.meetingId, id));
  if (!t) throw new NotFoundError("transcript");
  return { lang: t.lang, format: t.format, body: t.body, importedAt: t.importedAt, deleteAfter: t.deleteAfter };
}

/**
 * Import (or replace) a held meeting's transcript. The database refuses it
 * unless the meeting records that participants were told, and sets when it
 * will be deleted.
 */
export async function importTranscript(
  tx: Tx,
  principal: Principal,
  id: string,
  input: { text: string; format: TranscriptFormat; lang: SpokenLang },
) {
  const { meeting } = await loadForTranscript(tx, principal, id);
  if (!meeting.transcriptConsent)
    throw new BadRequestError("record that participants were told the meeting may be transcribed first");
  if (meeting.status !== "held") throw new BadRequestError("mark the meeting held first");
  const body = parseTranscript(input.text, input.format);
  if (!body) throw new BadRequestError("the file has no transcript text");
  if (body.length > TRANSCRIPT_MAX_CHARS) throw new BadRequestError("the transcript is too long");
  await tx.delete(meetingTranscripts).where(eq(meetingTranscripts.meetingId, id));
  const [row] = await tx
    .insert(meetingTranscripts)
    .values({
      meetingId: id,
      projectId: meeting.projectId,
      orgId: meeting.orgId,
      lang: input.lang,
      format: input.format,
      body,
      importedBy: principal.userId,
      deleteAfter: "1970-01-01", // set by the database
    })
    .returning({ deleteAfter: meetingTranscripts.deleteAfter });
  return { chars: body.length, deleteAfter: row!.deleteAfter };
}

export async function deleteTranscript(tx: Tx, principal: Principal, id: string) {
  await loadForTranscript(tx, principal, id);
  const gone = await tx
    .delete(meetingTranscripts)
    .where(eq(meetingTranscripts.meetingId, id))
    .returning({ id: meetingTranscripts.meetingId });
  if (!gone.length) throw new NotFoundError("transcript");
  return { ok: true };
}

export async function updateMeeting(
  tx: Tx,
  principal: Principal,
  id: string,
  {
    audience,
    ...change
  }: Partial<MeetingInput> & { status?: "held" | "cancelled"; transcriptConsent?: boolean; audience?: AudienceInput | null },
) {
  const { meeting, resource } = await loadMeeting(tx, principal, id);
  assertAllowed(principal, "meeting.run", resource);
  const updated = Object.keys(change).length
    ? await tx.update(meetings).set(change).where(eq(meetings.id, id)).returning({ sequence: meetings.icsSequence })
    : [{ sequence: meeting.icsSequence }];
  if (!updated.length) throw new NotFoundError("meeting");
  // Who sees it, changed in the edit form (feature A), by the people who may.
  if (audience) await writeAudience(tx, principal, "meeting", id, resource, audience, { on: "edit" });
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

/**
 * Who sees a meeting (feature A), for the people who may change it: firm
 * staff on a meeting the firm booked, the client's admin on one a client
 * person booked. Not found for anyone else.
 */
export async function getMeetingAudience(tx: Tx, principal: Principal, id: string) {
  const { resource } = await loadMeeting(tx, principal, id);
  return readAudience(tx, principal, "meeting", id, resource);
}

/** Set, change or clear who sees a meeting. Audited; nobody is told, and no invite reaches anyone left out. */
export async function setMeetingAudience(tx: Tx, principal: Principal, id: string, input: AudienceInput) {
  const { resource } = await loadMeeting(tx, principal, id);
  return writeAudience(tx, principal, "meeting", id, resource, input);
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

// ----------------------------------------------------------- follow-ups

export interface FollowUpInput {
  title: string;
  dueAt?: Date | null;
  assigneeUserId?: string | null;
  decisionId?: string | null;
  visibility?: Visibility;
}

/** A follow-up out of the meeting. The firm writes them (RLS); the database checks the assignee. */
export async function addFollowUp(tx: Tx, principal: Principal, id: string, input: FollowUpInput) {
  const { meeting, resource } = await loadMeeting(tx, principal, id);
  assertAllowed(principal, "follow_up.write", { ...resource, type: "follow_up" });
  const [row] = await tx
    .insert(followUps)
    .values({
      projectId: meeting.projectId,
      orgId: meeting.orgId,
      meetingId: id,
      meetingDecisionId: input.decisionId ?? null,
      title: input.title,
      dueAt: input.dueAt ?? null,
      assigneeUserId: input.assigneeUserId ?? null,
      visibility: input.visibility ?? meeting.visibility,
      createdBy: principal.userId,
    })
    .returning({ id: followUps.id });
  return row!;
}

/**
 * Change a follow-up. The firm changes anything but its meeting; the
 * assignee only marks it done or open again (both checked by the database).
 */
export async function updateFollowUp(
  tx: Tx,
  principal: Principal,
  followUpId: string,
  change: Partial<Omit<FollowUpInput, "decisionId">> & { status?: "open" | "done" },
) {
  const [f] = await tx.select().from(followUps).where(eq(followUps.id, followUpId));
  if (!f) throw new NotFoundError("follow-up");
  const mine = f.assigneeUserId === principal.userId;
  if (!mine) {
    const { resource } = await loadProject(tx, principal, f.projectId);
    assertAllowed(principal, "follow_up.write", { ...resource, type: "follow_up", visibility: f.visibility });
  } else if (principal.orgKind !== "firm" && Object.keys(change).some((k) => k !== "status")) {
    throw new BadRequestError("only mark it done or open");
  }
  const updated = await tx.update(followUps).set(change).where(eq(followUps.id, followUpId)).returning({ id: followUps.id });
  if (!updated.length) throw new NotFoundError("follow-up");
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
      ${
        // An action owner opens only their own actions and follow-ups (policy.ts: "assigned"). Row-level
        // security says the same since migration 0081; this stays as a second lock. Meetings stay as they are.
        principal.role === "action_owner" ? sql`and (s.item_type = 'meeting' or ${principal.userId}::uuid = any (s.people))` : sql``
      }
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
