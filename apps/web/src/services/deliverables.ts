import "server-only";
import { and, asc, desc, eq, inArray, isNull, ne, sql, type SQL } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { deliverableHandovers, documents, engagementDeliverables, engagements, organizations, projects, user } from "@/db/schema";
import { assertAllowed, authorize, type Principal, type Resource } from "@/authz";
import { receiptStatus, type CommentInput, type ReceiptInput, type ReceiptStatus } from "@/lib/deliverables";
import { BadRequestError, NotFoundError } from "@/server/errors";
import { audit } from "./audit";
import { fileControls, loadDocument, shareDocument } from "./documents";
import { downloadable } from "./scan";

// A deliverable handed over, and the client's receipt (F21, minimal;
// migration 0130_deliverable_receipts). The firm hands over the exact file
// versions; the client's acceptor (else its admin, else its sponsor) confirms
// receipt or comments; for a client the firm runs, the consultant records the
// receipt. Every round is kept. "Received" is receipt only, never acceptance.
// Row-level security decides who reads a round (app_can_read_handover) and the
// database functions decide who writes one; the checks here give clear answers.

interface Deliverable {
  id: string;
  engagementId: string;
  /** Null for a client person who answers for it but does not read the engagement (only its admin does). */
  engagementTitle: string | null;
  title: string;
  acceptanceCriteria: string | null;
  dueOn: string | null;
  projectId: string | null;
  projectTitle: string | null;
  clientOrgId: string;
  firmOrgId: string;
  clientName: string;
  clientNameAr: string | null;
  engagementMode: "full" | "restricted" | "consultant_managed" | null;
  archived: boolean;
  projectState: Resource["projectState"];
}

const resourceOf = (d: Pick<Deliverable, "id" | "clientOrgId" | "firmOrgId" | "engagementMode" | "projectState">): Resource => ({
  type: "deliverable",
  id: d.id,
  orgId: d.clientOrgId,
  firmOrgId: d.firmOrgId,
  projectId: null,
  clientOrgId: d.clientOrgId,
  engagementMode: d.engagementMode,
  // A closed project's deliverables stay as they are (authorize refuses writes; so does the database).
  projectState: d.projectState,
});

/**
 * The deliverables the reader's row-level security lets through, with their
 * client and firm. A client person who answers for a hand-over reads the
 * deliverable but not its engagement (only the client's admin does), so the
 * client comes from app_deliverable_parties(), which answers for exactly the
 * deliverables the reader sees, and the engagement's title stays null for them.
 */
async function fetchDeliverables(tx: Tx, where: SQL | undefined): Promise<Deliverable[]> {
  const rows = await tx
    .select({
      id: engagementDeliverables.id,
      engagementId: engagementDeliverables.engagementId,
      engagementTitle: engagements.title,
      title: engagementDeliverables.title,
      acceptanceCriteria: engagementDeliverables.acceptanceCriteria,
      dueOn: engagementDeliverables.dueOn,
      projectId: engagementDeliverables.projectId,
      projectTitle: projects.title,
      projectState: projects.state,
    })
    .from(engagementDeliverables)
    .leftJoin(engagements, eq(engagements.id, engagementDeliverables.engagementId))
    .leftJoin(projects, eq(projects.id, engagementDeliverables.projectId))
    .where(where)
    .orderBy(sql`${engagements.signedOn} asc nulls last`, sql`${engagementDeliverables.dueOn} asc nulls last`, asc(engagementDeliverables.createdAt));
  if (!rows.length) return [];
  const { rows: parties } = await tx.execute<{ deliverable_id: string; client_org_id: string; firm_org_id: string }>(
    sql`select * from app_deliverable_parties(${sql.param(rows.map((r) => r.id))}::uuid[])`,
  );
  const partyOf = new Map(parties.map((p) => [p.deliverable_id, p]));
  const clients = [...new Set(parties.map((p) => p.client_org_id))];
  const orgs = new Map(
    (
      await tx
        .select({ id: organizations.id, name: organizations.name, nameAr: organizations.nameAr, engagementMode: organizations.engagementMode, status: organizations.status })
        .from(organizations)
        .where(inArray(organizations.id, clients))
    ).map((o) => [o.id, o]),
  );
  return rows.flatMap((r) => {
    const party = partyOf.get(r.id);
    const org = party ? orgs.get(party.client_org_id) : undefined;
    if (!party || !org) return [];
    return [
      {
        ...r,
        clientOrgId: party.client_org_id,
        firmOrgId: party.firm_org_id,
        clientName: org.name,
        clientNameAr: org.nameAr,
        engagementMode: org.engagementMode,
        archived: org.status === "archived",
        projectState: r.projectState ?? undefined,
      },
    ];
  });
}

/** A deliverable the person may read (row-level security first, then authorize()); 404 otherwise. */
async function loadDeliverable(tx: Tx, principal: Principal, id: string): Promise<{ row: Deliverable; resource: Resource }> {
  const [row] = await fetchDeliverables(tx, eq(engagementDeliverables.id, id));
  if (!row) throw new NotFoundError("deliverable");
  const resource = resourceOf(row);
  assertAllowed(principal, "deliverable.read", resource);
  return { row, resource };
}

export interface HandoverFile {
  id: string;
  title: string;
  version: number;
}

/** One round: the files handed over, and the client's answer if any. */
export interface HandoverRound {
  id: string;
  round: number;
  deliveredAt: Date;
  deliveredBy: string | null;
  files: HandoverFile[];
  /** Files of the round this reader cannot open: counted, never named. */
  hiddenFiles: number;
  receivedAt: Date | null;
  receivedBy: string | null;
  /** client_portal: confirmed in Selah; consultant_recorded: recorded by the firm for a client it runs. */
  receiptSource: "client_portal" | "consultant_recorded" | "internal" | null;
  receivedByName: string | null;
  receivedVia: "meeting" | "email" | "phone" | "document" | null;
  receivedOn: string | null;
  comment: string | null;
  commentedAt: Date | null;
  commentedBy: string | null;
  remindedAt: Date | null;
}

/** The rounds of these deliverables the person may read, newest first, by deliverable. */
export async function roundsOf(tx: Tx, deliverableIds: string[]): Promise<Map<string, HandoverRound[]>> {
  const out = new Map<string, HandoverRound[]>();
  if (!deliverableIds.length) return out;
  const rows = await tx
    .select()
    .from(deliverableHandovers)
    .where(inArray(deliverableHandovers.deliverableId, deliverableIds))
    .orderBy(asc(deliverableHandovers.deliverableId), desc(deliverableHandovers.round));
  if (!rows.length) return out;
  const people = [...new Set(rows.flatMap((r) => [r.deliveredBy, r.receivedBy, r.commentedBy]).filter((x): x is string => !!x))];
  const names = new Map<string, string>();
  for (const u of await tx.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, people))) names.set(u.id, u.name);
  // Titles under the reader's own rights: a file they cannot open is counted, not named.
  const fileIds = [...new Set(rows.flatMap((r) => r.versionIds))];
  const files = new Map<string, HandoverFile>();
  for (const f of await tx
    .select({ id: documents.id, title: documents.title, version: documents.version })
    .from(documents)
    .where(inArray(documents.id, fileIds))) {
    files.set(f.id, f);
  }
  for (const r of rows) {
    const seen = r.versionIds.map((v) => files.get(v)).filter((f): f is HandoverFile => !!f);
    const round: HandoverRound = {
      id: r.id,
      round: r.round,
      deliveredAt: r.deliveredAt,
      deliveredBy: names.get(r.deliveredBy) ?? null,
      files: seen,
      hiddenFiles: r.versionIds.length - seen.length,
      receivedAt: r.receivedAt,
      receivedBy: r.receivedBy ? (names.get(r.receivedBy) ?? null) : null,
      receiptSource: r.receiptSource,
      receivedByName: r.receivedByName,
      receivedVia: r.receivedVia,
      receivedOn: r.receivedOn,
      comment: r.comment,
      commentedAt: r.commentedAt,
      commentedBy: r.commentedBy ? (names.get(r.commentedBy) ?? null) : null,
      remindedAt: r.remindedAt,
    };
    out.set(r.deliverableId, [...(out.get(r.deliverableId) ?? []), round]);
  }
  return out;
}

/** What the person may do on a deliverable now. */
function canOn(principal: Principal, d: Deliverable, rounds: HandoverRound[]) {
  const resource = resourceOf(d);
  const latest = rounds[0];
  const open = !d.archived && d.projectState !== "closed";
  const waiting = open && !!latest && !latest.receivedAt && !latest.commentedAt;
  const firmRun = d.engagementMode === "consultant_managed";
  return {
    handOver: open && authorize(principal, "deliverable.hand_over", resource).allowed,
    // The client's receiver reads the round only when they may answer it (app_can_read_handover).
    confirm: waiting && principal.orgKind === "client" && latest.hiddenFiles === 0 && authorize(principal, "deliverable.receive", resource).allowed,
    comment: waiting && principal.orgKind === "client" && latest.hiddenFiles === 0 && authorize(principal, "deliverable.comment", resource).allowed,
    // For a client the firm runs, the consultant records the receipt.
    record: waiting && firmRun && principal.orgKind === "firm" && authorize(principal, "deliverable.receive", resource).allowed,
  };
}

export interface DeliverableView {
  id: string;
  engagementId: string;
  engagementTitle: string | null;
  title: string;
  acceptanceCriteria: string | null;
  dueOn: string | null;
  projectId: string | null;
  projectTitle: string | null;
  clientOrgId: string;
  status: ReceiptStatus;
  rounds: HandoverRound[];
  can: ReturnType<typeof canOn>;
}

const view = (principal: Principal, d: Deliverable, rounds: HandoverRound[]): DeliverableView => ({
  id: d.id,
  engagementId: d.engagementId,
  engagementTitle: d.engagementTitle,
  title: d.title,
  acceptanceCriteria: d.acceptanceCriteria,
  dueOn: d.dueOn,
  projectId: d.projectId,
  projectTitle: d.projectTitle,
  clientOrgId: d.clientOrgId,
  status: receiptStatus(rounds),
  rounds,
  can: canOn(principal, d, rounds),
});

/**
 * Deliverables with their status, rounds and what the reader may do: an
 * engagement's (its page), or the ones a client person answers for (their
 * home), or a client's (the closure report, the export pack). Rows come
 * through row-level security and each passes authorize().
 */
export async function listDeliverables(
  tx: Tx,
  principal: Principal,
  where: { engagementId?: string; clientOrgId?: string; handedOverOnly?: boolean },
): Promise<DeliverableView[]> {
  const rows = await fetchDeliverables(tx, where.engagementId ? eq(engagementDeliverables.engagementId, where.engagementId) : undefined);
  const readable = rows.filter(
    (d) => (!where.clientOrgId || d.clientOrgId === where.clientOrgId) && authorize(principal, "deliverable.read", resourceOf(d)).allowed,
  );
  const rounds = await roundsOf(
    tx,
    readable.map((d) => d.id),
  );
  return readable
    .filter((d) => !where.handedOverOnly || rounds.has(d.id))
    .map((d) => view(principal, d, rounds.get(d.id) ?? []));
}

/** The deliverables a client person answers for: on their home, with the card to confirm receipt or comment. */
export async function deliverablesToAnswer(tx: Tx, principal: Principal): Promise<DeliverableView[]> {
  if (principal.orgKind !== "client" || !["client_admin", "client_manager"].includes(principal.role)) return [];
  return listDeliverables(tx, principal, { clientOrgId: principal.orgId, handedOverOnly: true });
}

/** One deliverable as the reader sees it. */
export async function getDeliverable(tx: Tx, principal: Principal, id: string): Promise<DeliverableView> {
  const { row } = await loadDeliverable(tx, principal, id);
  const rounds = await roundsOf(tx, [id]);
  return view(principal, row, rounds.get(id) ?? []);
}

export interface HandOverChoice {
  /** The file's first version: one choice per file, whatever its versions. */
  key: string;
  projectTitle: string;
  /** Newest first. */
  versions: { id: string; version: number; title: string; createdAt: Date; firmOnly: boolean }[];
  /** Picked to start with: a file handed over in the last round, at its latest version. */
  picked: boolean;
}

/**
 * The files the hand-over dialog offers: this client's deliverable files the
 * person can open, cleared by the scan, live, on a project past draft, and
 * shared with the client, or the firm-only latest version the person may
 * share (handing it over shares it, as "Share with the client" does).
 */
export async function handOverChoices(tx: Tx, principal: Principal, id: string): Promise<HandOverChoice[]> {
  const { row, resource } = await loadDeliverable(tx, principal, id);
  assertAllowed(principal, "deliverable.hand_over", resource);
  const rows = await tx
    .select({
      id: documents.id,
      title: documents.title,
      version: documents.version,
      supersedesId: documents.supersedesId,
      visibility: documents.visibility,
      scanStatus: documents.scanStatus,
      createdAt: documents.createdAt,
      projectId: documents.projectId,
      projectTitle: projects.title,
    })
    .from(documents)
    .innerJoin(projects, eq(projects.id, documents.projectId))
    .where(
      and(
        eq(documents.orgId, row.clientOrgId),
        eq(documents.purpose, "deliverable"),
        ne(documents.state, "archived"),
        isNull(documents.withdrawnAt),
        sql`${projects.state}::text <> 'draft'`,
      ),
    )
    .orderBy(asc(projects.title), asc(documents.createdAt));
  const next = new Map(rows.filter((d) => d.supersedesId).map((d) => [d.supersedesId!, d]));
  const byId = new Map(rows.map((d) => [d.id, d]));
  const last = (await roundsOf(tx, [id])).get(id)?.[0];
  const lastIds = new Set(last ? last.files.map((f) => f.id) : []);
  const choices: HandOverChoice[] = [];
  for (const first of rows.filter((d) => !d.supersedesId || !byId.has(d.supersedesId))) {
    const chain = [first];
    for (let n = next.get(first.id); n; n = next.get(n.id)) chain.push(n);
    const latestId = chain[chain.length - 1]!.id;
    const versions = [...chain]
      .reverse()
      .filter((d) => downloadable(d.scanStatus))
      .filter((d) => d.visibility === "shared" || (d.visibility === "firm_private" && d.id === latestId))
      .map((d) => ({ id: d.id, version: d.version, title: d.title, createdAt: d.createdAt, firmOnly: d.visibility === "firm_private" }));
    if (!versions.length) continue;
    choices.push({ key: first.id, projectTitle: first.projectTitle, versions, picked: chain.some((d) => lastIds.has(d.id)) });
  }
  return choices;
}

/**
 * Hand a deliverable over: the exact versions picked, in a new round. A
 * firm-only version is shared with the client first, as the file's own
 * "Share with the client" does (one-way, recorded). The client's receivers are
 * told by the database. Audited.
 */
export async function handOverDeliverable(tx: Tx, principal: Principal, id: string, versionIds: string[]) {
  const { row, resource } = await loadDeliverable(tx, principal, id);
  assertAllowed(principal, "deliverable.hand_over", resource);
  if (new Set(versionIds).size !== versionIds.length) throw new BadRequestError("pick each file once");
  let shared = 0;
  for (const versionId of versionIds) {
    const loaded = await loadDocument(tx, versionId);
    if (!loaded || loaded.doc.orgId !== row.clientOrgId || loaded.doc.purpose !== "deliverable") throw new BadRequestError("hand over this client's deliverable files");
    if (loaded.doc.visibility === "firm_private") {
      if (!fileControls(principal, loaded).shareWithClient) throw new BadRequestError("share the latest version of a firm-only file, or pick one shared with the client");
      await shareDocument(tx, principal, versionId);
      shared++;
    }
  }
  const { rows } = await tx.execute<{ id: string }>(sql`select app_hand_over_deliverable(${id}::uuid, ${sql.param(versionIds)}::uuid[]) as id`);
  const handoverId = rows[0]!.id;
  const [made] = await tx.select({ round: deliverableHandovers.round }).from(deliverableHandovers).where(eq(deliverableHandovers.id, handoverId));
  await audit(tx, {
    actorId: principal.userId,
    orgId: principal.orgId,
    action: "deliverable.hand_over",
    resourceType: "deliverable",
    resourceId: id,
    outcome: "allow",
    meta: { round: made?.round ?? null, files: versionIds.length, shared },
  });
  return { id: handoverId, round: made?.round ?? null };
}

/**
 * The receipt of the round the reader saw. The client's acceptor, admin or
 * sponsor confirms it; for a client the firm runs, the consultant records who
 * at the client received it, how and on which day. Once per round. Audited.
 */
export async function recordReceipt(tx: Tx, principal: Principal, id: string, input: ReceiptInput) {
  const { resource } = await loadDeliverable(tx, principal, id);
  assertAllowed(principal, "deliverable.receive", resource);
  if (principal.orgKind === "firm") {
    if (!input.receivedBy || !input.receivedVia || !input.receivedOn) throw new BadRequestError("say who at the client received it, how and on which day");
    await tx.execute(
      sql`select app_record_deliverable_receipt(${id}::uuid, ${input.round}::integer, ${input.receivedBy}, ${input.receivedVia}::received_via, ${input.receivedOn}::date)`,
    );
  } else {
    if (input.receivedBy || input.receivedVia || input.receivedOn) throw new BadRequestError("only the firm records who received it");
    await tx.execute(sql`select app_confirm_deliverable_receipt(${id}::uuid, ${input.round}::integer)`);
  }
  await audit(tx, {
    actorId: principal.userId,
    orgId: principal.orgId,
    action: principal.orgKind === "firm" ? "deliverable.receipt_record" : "deliverable.receipt",
    resourceType: "deliverable",
    resourceId: id,
    outcome: "allow",
    meta: { round: input.round, ...(input.receivedVia ? { via: input.receivedVia } : {}) },
  });
  return getDeliverable(tx, principal, id);
}

/** A comment instead of a receipt, for the round the reader saw. The client's lead and deputy are told. Audited. */
export async function commentOnDeliverable(tx: Tx, principal: Principal, id: string, input: CommentInput) {
  const { resource } = await loadDeliverable(tx, principal, id);
  assertAllowed(principal, "deliverable.comment", resource);
  await tx.execute(sql`select app_comment_on_deliverable(${id}::uuid, ${input.round}::integer, ${input.comment})`);
  await audit(tx, {
    actorId: principal.userId,
    orgId: principal.orgId,
    action: "deliverable.comment",
    resourceType: "deliverable",
    resourceId: id,
    outcome: "allow",
    meta: { round: input.round },
  });
  return getDeliverable(tx, principal, id);
}

/** Counts by status for each engagement of a client (its page's engagements card). */
export async function statusCounts(tx: Tx, principal: Principal, clientOrgId: string) {
  const out = new Map<string, Partial<Record<ReceiptStatus, number>>>();
  for (const d of await listDeliverables(tx, principal, { clientOrgId })) {
    const c = out.get(d.engagementId) ?? {};
    c[d.status] = (c[d.status] ?? 0) + 1;
    out.set(d.engagementId, c);
  }
  return out;
}
