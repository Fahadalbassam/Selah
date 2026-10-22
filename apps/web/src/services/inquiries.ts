import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import {
  discoverySessions,
  inquiries,
  inquiryEvents,
  inquiryServices,
  organizations,
  projects,
  sectors,
  serviceAreas,
  user,
} from "@/db/schema";
import { assertAllowed, authorize, type EngagementMode, type Principal, type Resource } from "@/authz";
import { BadRequestError, NotFoundError } from "@/server/errors";
import { audit } from "./audit";
import { createClient, setLead } from "./staffing";

// The firm's side of intake: triage, discovery, and turning a won inquiry
// into a client. The database holds the same rules
// (drizzle/0017_intake_rules.sql); these checks give clear errors.

type Status = (typeof inquiries.$inferSelect)["status"];

// The moves the inquiry's owner can make. Everything else is the admin's.
const FORWARD: Partial<Record<Status, Status>> = {
  new: "triaged",
  triaged: "discovery_scheduled",
  discovery_scheduled: "discovery_done",
  discovery_done: "proposal_sent",
};

function firmStaff(principal: Principal) {
  if (principal.orgKind !== "firm") throw new NotFoundError("inquiry");
}

const resourceOf = (principal: Principal, row: { id: string; firmOrgId: string; ownerUserId: string | null }): Resource => ({
  type: "inquiry",
  id: row.id,
  orgId: row.firmOrgId,
  firmOrgId: row.firmOrgId,
  projectId: null,
  assignees: row.ownerUserId ? [row.ownerUserId] : [],
});

/** Load an inquiry the user may read. Unknown and forbidden look the same (404). */
async function loadInquiry(tx: Tx, principal: Principal, id: string) {
  firmStaff(principal);
  const [row] = await tx.select().from(inquiries).where(eq(inquiries.id, id)).limit(1);
  if (!row) throw new NotFoundError("inquiry");
  const resource = resourceOf(principal, row);
  assertAllowed(principal, "inquiry.read", resource);
  return { row, resource };
}

async function serviceCodes(tx: Tx, ids: string[]) {
  if (!ids.length) return new Map<string, string[]>();
  const rows = await tx
    .select({ inquiryId: inquiryServices.inquiryId, code: serviceAreas.code })
    .from(inquiryServices)
    .innerJoin(serviceAreas, eq(serviceAreas.id, inquiryServices.serviceAreaId))
    .where(inArray(inquiryServices.inquiryId, ids))
    .orderBy(asc(serviceAreas.sortOrder));
  const out = new Map<string, string[]>();
  for (const r of rows) out.set(r.inquiryId, [...(out.get(r.inquiryId) ?? []), r.code]);
  return out;
}

/** The inbox: every inquiry for an admin, the ones handed to them for a consultant (RLS). */
export async function listInquiries(tx: Tx, principal: Principal) {
  firmStaff(principal);
  const rows = await tx
    .select({
      id: inquiries.id,
      publicRef: inquiries.publicRef,
      orgName: inquiries.orgName,
      orgNameAr: inquiries.orgNameAr,
      sector: sectors.code,
      employeeBand: inquiries.employeeBand,
      urgency: inquiries.urgency,
      status: inquiries.status,
      ownerUserId: inquiries.ownerUserId,
      ownerName: user.name,
      conflictStatus: inquiries.conflictStatus,
      createdAt: inquiries.createdAt,
    })
    .from(inquiries)
    .innerJoin(sectors, eq(sectors.id, inquiries.sectorId))
    .leftJoin(user, eq(user.id, inquiries.ownerUserId))
    .orderBy(desc(inquiries.createdAt))
    .limit(200);
  const services = await serviceCodes(
    tx,
    rows.map((r) => r.id),
  );
  return rows.map((r) => ({ ...r, services: services.get(r.id) ?? [] }));
}

export async function getInquiry(tx: Tx, principal: Principal, id: string) {
  const { row, resource } = await loadInquiry(tx, principal, id);
  const [sector] = await tx.select({ code: sectors.code }).from(sectors).where(eq(sectors.id, row.sectorId));
  const events = await tx
    .select({
      id: inquiryEvents.id,
      event: inquiryEvents.event,
      fromStatus: inquiryEvents.fromStatus,
      toStatus: inquiryEvents.toStatus,
      note: inquiryEvents.note,
      meta: inquiryEvents.meta,
      actorName: user.name,
      createdAt: inquiryEvents.createdAt,
    })
    .from(inquiryEvents)
    .leftJoin(user, eq(user.id, inquiryEvents.actorId))
    .where(eq(inquiryEvents.inquiryId, id))
    .orderBy(asc(inquiryEvents.createdAt));
  const sessions = await tx
    .select()
    .from(discoverySessions)
    .where(eq(discoverySessions.inquiryId, id))
    .orderBy(asc(discoverySessions.scheduledAt));
  // The hashes are for the rate limit, not for people.
  const { ipHash, userAgentHash, sectorId, ...inquiry } = row;
  void [ipHash, userAgentHash, sectorId];
  return {
    inquiry: { ...inquiry, sector: sector!.code, services: (await serviceCodes(tx, [id])).get(id) ?? [] },
    events,
    discoverySessions: sessions,
    can: {
      work: authorize(principal, "inquiry.work", resource).allowed,
      decide: authorize(principal, "inquiry.decide", resource).allowed,
      /** Moving forward, as the owner may; null once there is no next step. */
      forward: FORWARD[row.status] ?? null,
      convert:
        authorize(principal, "inquiry.decide", resource).allowed &&
        !row.clientOrgId &&
        ["discovery_done", "proposal_sent"].includes(row.status) &&
        ["clear", "waived"].includes(row.conflictStatus),
    },
  };
}

export interface InquiryChange {
  status?: Status;
  ownerUserId?: string | null;
  conflictStatus?: "not_checked" | "clear" | "flagged" | "waived";
  conflictNote?: string | null;
}

export async function updateInquiry(tx: Tx, principal: Principal, id: string, change: InquiryChange) {
  const { row, resource } = await loadInquiry(tx, principal, id);
  const forwardOnly =
    change.ownerUserId === undefined &&
    change.conflictStatus === undefined &&
    change.conflictNote === undefined &&
    (change.status === undefined || FORWARD[row.status] === change.status);
  assertAllowed(principal, forwardOnly ? "inquiry.work" : "inquiry.decide", resource);
  if (change.status === "won") throw new BadRequestError("an inquiry is won by converting it to a client");
  await tx
    .update(inquiries)
    .set({
      status: change.status,
      ownerUserId: change.ownerUserId,
      conflictStatus: change.conflictStatus,
      conflictNote: change.conflictNote,
    })
    .where(eq(inquiries.id, id));
  await audit(tx, {
    actorId: principal.userId,
    orgId: principal.orgId,
    action: "inquiry.update",
    resourceType: "inquiry",
    resourceId: id,
    outcome: "allow",
    meta: Object.fromEntries(Object.entries(change).filter(([k, v]) => k !== "conflictNote" && v !== undefined)),
  });
  return { ok: true };
}

export async function addInquiryNote(tx: Tx, principal: Principal, id: string, note: string) {
  const { resource } = await loadInquiry(tx, principal, id);
  assertAllowed(principal, "inquiry.work", resource);
  await tx.insert(inquiryEvents).values({ inquiryId: id, actorId: principal.userId, event: "note", note });
  return { ok: true };
}

/** Book the discovery session; the inquiry moves to discovery_scheduled. */
export async function scheduleDiscovery(
  tx: Tx,
  principal: Principal,
  id: string,
  input: { scheduledAt: Date; mode: "in_person" | "video" | "phone"; attendees?: string },
) {
  const { row, resource } = await loadInquiry(tx, principal, id);
  assertAllowed(principal, "inquiry.work", resource);
  if (!["new", "triaged", "discovery_scheduled"].includes(row.status)) {
    throw new BadRequestError("discovery is booked before the proposal");
  }
  const sessionId = randomUUID();
  await tx.insert(discoverySessions).values({ id: sessionId, inquiryId: id, ...input, createdBy: principal.userId });
  // One step at a time, as the database allows.
  for (let s: Status = row.status; s !== "discovery_scheduled"; s = FORWARD[s]!) {
    await tx.update(inquiries).set({ status: FORWARD[s]! }).where(eq(inquiries.id, id));
  }
  return { id: sessionId };
}

/** Record how the session went; the first outcome moves the inquiry to discovery_done. */
export async function recordDiscovery(
  tx: Tx,
  principal: Principal,
  sessionId: string,
  input: { heldAt?: Date; notes?: string; outcome?: "proceed" | "not_a_fit" | "needs_followup" },
) {
  const [session] = await tx.select().from(discoverySessions).where(eq(discoverySessions.id, sessionId)).limit(1);
  if (!session) throw new NotFoundError("discovery session");
  const { row, resource } = await loadInquiry(tx, principal, session.inquiryId);
  assertAllowed(principal, "inquiry.work", resource);
  const heldAt = input.heldAt ?? (input.outcome && !session.heldAt ? new Date() : undefined);
  await tx
    .update(discoverySessions)
    .set({ heldAt, notes: input.notes, outcome: input.outcome })
    .where(eq(discoverySessions.id, sessionId));
  if (input.outcome && row.status === "discovery_scheduled") {
    await tx.update(inquiries).set({ status: "discovery_done" }).where(eq(inquiries.id, row.id));
  }
  return { ok: true };
}

/** Consultants whose declared expertise fits the inquiry. A suggestion only: the admin assigns. */
export async function suggestLeads(tx: Tx, principal: Principal, id: string) {
  const { resource } = await loadInquiry(tx, principal, id);
  assertAllowed(principal, "lead_suggestion.read", resource);
  const { rows } = await tx.execute<{
    user_id: string;
    name: string;
    matched_services: string[];
    sector_match: boolean;
    speaks_language: boolean;
    accepting_new_clients: boolean;
    active_clients: number;
  }>(sql`select * from app_suggest_leads(${id})`);
  return rows.map((r) => ({
    userId: r.user_id,
    name: r.name,
    matchedServices: r.matched_services,
    sectorMatch: r.sector_match,
    speaksLanguage: r.speaks_language,
    acceptingNewClients: r.accepting_new_clients,
    activeClients: r.active_clients,
  }));
}

export interface Conversion {
  /** A new client organisation, or an existing one (a returning client). */
  /** A new client starts in the engagement mode chosen here (full by default); an existing one keeps its own. */
  client: { name: string; nameAr?: string; engagementMode?: EngagementMode } | { existingClientId: string };
  leadUserId?: string;
  /** Starts the first engagement, planned, when given. */
  projectTitle?: string;
}

/**
 * Win the inquiry and make it a client, in one transaction: the client
 * organisation (or an existing one), its lead, and optionally the first
 * project. The database refuses it unless the conflict check is clear or
 * waived. Inviting the client's people is a separate step.
 */
export async function convertInquiry(tx: Tx, principal: Principal, id: string, input: Conversion) {
  const { row, resource } = await loadInquiry(tx, principal, id);
  assertAllowed(principal, "inquiry.decide", resource);
  if (row.clientOrgId) throw new BadRequestError("this inquiry is already a client");
  if (!["discovery_done", "proposal_sent", "won"].includes(row.status)) {
    throw new BadRequestError("an inquiry is won after discovery");
  }
  if (!["clear", "waived"].includes(row.conflictStatus)) throw new BadRequestError("check for conflicts first");

  let clientOrgId: string;
  if ("existingClientId" in input.client) {
    const [client] = await tx
      .select({ id: organizations.id })
      .from(organizations)
      .where(and(eq(organizations.id, input.client.existingClientId), eq(organizations.kind, "client")))
      .limit(1);
    if (!client) throw new NotFoundError("client");
    clientOrgId = client.id;
  } else {
    clientOrgId = (await createClient(tx, principal, input.client)).id;
  }
  if (input.leadUserId) await setLead(tx, principal, clientOrgId, input.leadUserId);

  let projectId: string | undefined;
  if (input.projectTitle) {
    assertAllowed(principal, "project.create", {
      type: "project",
      orgId: clientOrgId,
      firmOrgId: principal.orgId,
      projectId: null,
      projectKind: "client",
    });
    projectId = randomUUID();
    await tx.insert(projects).values({
      id: projectId,
      kind: "client",
      orgId: clientOrgId,
      firmOrgId: principal.orgId,
      title: input.projectTitle,
      state: "planned",
      createdBy: principal.userId,
    });
  }
  await tx.update(inquiries).set({ status: "won", clientOrgId }).where(eq(inquiries.id, id));
  await audit(tx, {
    actorId: principal.userId,
    orgId: principal.orgId,
    action: "inquiry.convert",
    resourceType: "inquiry",
    resourceId: id,
    outcome: "allow",
    meta: { clientOrgId, projectId: projectId ?? null },
  });
  return { clientOrgId, projectId };
}
