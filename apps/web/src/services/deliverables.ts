import "server-only";
import { and, asc, desc, eq, inArray, isNull, ne, sql, type SQL } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { deliverableHandovers, documents, engagementDeliverables, engagements, organizations, projects, user } from "@/db/schema";
import { assertAllowed, authorize, type Principal, type Resource } from "@/authz";
import { latestStatus, type CommentInput, type ReceiptInput, type ReceiptStatus } from "@/lib/deliverables";
import { BadRequestError, NotFoundError } from "@/server/errors";
import { audit } from "./audit";
import { loadDocument } from "./documents";
import { downloadable } from "./scan";

// A deliverable handed over, and the client's receipt (F21, minimal;
// migration 0092_deliverable_receipts). The firm hands over the exact file
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
  /** The engagement's projects that are not closed, as far as the reader sees them (who hands over: scope `engagement`). */
  openProjectIds: string[];
  /** The latest round, whoever reads: its number and state (never its files: review S3). */
  latestRound: number | null;
  latestState: "waiting" | "received" | "commented" | null;
}

const resourceOf = (d: Pick<Deliverable, "id" | "clientOrgId" | "firmOrgId" | "engagementMode" | "projectState" | "openProjectIds">): Resource => ({
  type: "deliverable",
  id: d.id,
  orgId: d.clientOrgId,
  firmOrgId: d.firmOrgId,
  projectId: null,
  clientOrgId: d.clientOrgId,
  engagementMode: d.engagementMode,
  // A closed project's deliverables stay as they are (authorize refuses writes; so does the database).
  projectState: d.projectState,
  relatedProjectIds: d.openProjectIds,
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
  const { rows: parties } = await tx.execute<{ deliverable_id: string; client_org_id: string; firm_org_id: string; latest_round: number | null; latest_state: Deliverable["latestState"] }>(
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
  // The engagements' projects that are not closed, under the reader's rights: who may hand over (scope "engagement").
  const engagementIds = [...new Set(rows.map((r) => r.engagementId))];
  const openProjects = await tx
    .select({ id: projects.id, engagementId: projects.engagementId })
    .from(projects)
    .where(and(inArray(projects.engagementId, engagementIds), ne(projects.state, "closed")));
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
        openProjectIds: openProjects.filter((p) => p.engagementId === r.engagementId).map((p) => p.id),
        latestRound: party.latest_round,
        latestState: party.latest_state,
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
  // Only the latest round is answered, and only by someone who reads it (the database checks the same).
  const waiting = open && !!latest && latest.round === d.latestRound && d.latestState === "waiting";
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
  /** Its project is closed: nothing more is written, and a round never answered says so. */
  closed: boolean;
  status: ReceiptStatus;
  /** The latest round's number, also when this reader cannot open it (its rounds then stop earlier). */
  latestRound: number | null;
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
  closed: d.projectState === "closed",
  status: latestStatus(d.latestState, d.projectState === "closed"),
  latestRound: d.latestRound,
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

/** Every deliverable handed over that a client person answers for (the deliverables page, /deliverables). */
export async function deliverablesHandedOver(tx: Tx, principal: Principal): Promise<DeliverableView[]> {
  if (principal.orgKind !== "client" || !["client_admin", "client_manager"].includes(principal.role)) return [];
  return listDeliverables(tx, principal, { clientOrgId: principal.orgId, handedOverOnly: true });
}

/**
 * Only the rounds waiting for this client person's answer: their home card,
 * whose one main action is Confirm receipt (review S6). Nothing when none wait.
 */
export async function deliverablesToAnswer(tx: Tx, principal: Principal): Promise<DeliverableView[]> {
  return (await deliverablesHandedOver(tx, principal)).filter((d) => d.can.confirm);
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
  /** The versions already shared with the client, newest first. */
  versions: { id: string; version: number; title: string; createdAt: Date }[];
  /** Picked to start with: a file handed over in the last round, at its latest version. */
  picked: boolean;
}

export interface HandOverChoices {
  files: HandOverChoice[];
  /** Files whose latest version is still firm-only: named, never offered (decision on B1). */
  firmOnly: { title: string; projectTitle: string }[];
}

/**
 * The files the hand-over dialog offers: this client's deliverable files the
 * person can open, cleared by the scan, live, on a project past draft, and
 * already shared with the client. A hand-over never shares anything: a file
 * whose latest version is still firm-only is only named, so the dialog can
 * point to the file's own Share action, which asks and warns first.
 */
export async function handOverChoices(tx: Tx, principal: Principal, id: string): Promise<HandOverChoices> {
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
        // Only the files of the deliverable's engagement's projects (S2).
        eq(projects.engagementId, row.engagementId),
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
  const files: HandOverChoice[] = [];
  const firmOnly: HandOverChoices["firmOnly"] = [];
  for (const first of rows.filter((d) => !d.supersedesId || !byId.has(d.supersedesId))) {
    const chain = [first];
    for (let n = next.get(first.id); n; n = next.get(n.id)) chain.push(n);
    const latest = chain[chain.length - 1]!;
    if (latest.visibility === "firm_private") firmOnly.push({ title: latest.title, projectTitle: latest.projectTitle });
    const versions = [...chain]
      .reverse()
      .filter((d) => d.visibility === "shared" && downloadable(d.scanStatus))
      .map((d) => ({ id: d.id, version: d.version, title: d.title, createdAt: d.createdAt }));
    if (!versions.length) continue;
    files.push({ key: first.id, projectTitle: first.projectTitle, versions, picked: chain.some((d) => lastIds.has(d.id)) });
  }
  return { files, firmOnly };
}

export interface HandOverPreview {
  /** Who will be asked to confirm receipt, and as what (the first group with anyone who opens every file). */
  asked: { name: string; as: "acceptor" | "admin" | "sponsor" }[];
  /** Acceptors who are not asked because they cannot open every file picked. */
  skipped: { name: string }[];
}

/**
 * Before a hand-over, who at the client will be asked for these files: the
 * acceptors, else the admins, else the sponsor, in each only people who open
 * every file; and the acceptors skipped because they cannot (S2). The database
 * decides (app_hand_over_preview), for someone who may hand it over.
 */
export async function handOverPreview(tx: Tx, principal: Principal, id: string, versionIds: string[]): Promise<HandOverPreview> {
  const { resource } = await loadDeliverable(tx, principal, id);
  assertAllowed(principal, "deliverable.hand_over", resource);
  const { rows } = await tx.execute<{ user_id: string; tier: number; asked: boolean }>(
    sql`select * from app_hand_over_preview(${id}::uuid, ${sql.param(versionIds)}::uuid[])`,
  );
  const names = new Map<string, string>();
  const people = [...new Set(rows.map((r) => r.user_id))];
  if (people.length) for (const u of await tx.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, people))) names.set(u.id, u.name);
  const as = ["acceptor", "admin", "sponsor"] as const;
  const askedIds = new Set(rows.filter((r) => r.asked).map((r) => r.user_id));
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
  return {
    asked: [...new Map(rows.filter((r) => r.asked).map((r) => [r.user_id, { name: names.get(r.user_id) ?? "—", as: as[r.tier - 1]! }])).values()].sort(byName),
    skipped: [...new Set(rows.filter((r) => !r.asked && !askedIds.has(r.user_id)).map((r) => r.user_id))].map((u) => ({ name: names.get(u) ?? "—" })).sort(byName),
  };
}

/**
 * Hand a deliverable over: the exact versions picked, in a new round. Only
 * versions already shared with the client: a hand-over never shares anything
 * (the file's own Share action does, and asks first). The client's receivers
 * are told by the database. Audited.
 */
export async function handOverDeliverable(tx: Tx, principal: Principal, id: string, versionIds: string[]) {
  const { row, resource } = await loadDeliverable(tx, principal, id);
  assertAllowed(principal, "deliverable.hand_over", resource);
  if (new Set(versionIds).size !== versionIds.length) throw new BadRequestError("pick each file once");
  for (const versionId of versionIds) {
    const loaded = await loadDocument(tx, versionId, principal);
    if (!loaded || loaded.doc.orgId !== row.clientOrgId || loaded.doc.purpose !== "deliverable") throw new BadRequestError("hand over this client's deliverable files");
    if (loaded.doc.visibility !== "shared") throw new BadRequestError("this file is firm-only: share it with the client first, from the file's own menu");
    const [project] = await tx.select({ engagementId: projects.engagementId }).from(projects).where(eq(projects.id, loaded.doc.projectId));
    if (project?.engagementId !== row.engagementId) throw new BadRequestError("hand over files of the engagement's projects");
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
    meta: { round: made?.round ?? null, files: versionIds.length },
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
