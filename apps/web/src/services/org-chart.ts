import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Tx } from "@/db/client";
import {
  departmentMembers,
  departments,
  documents,
  orgChartChangeRequests,
  orgCharts,
  orgChartVersions,
  organizations,
  orgMemberships,
  orgUnits,
  positionHolders,
  positions,
  user,
} from "@/db/schema";
import { assertAllowed, authorize, CLIENT_ROLES, OPEN_STATUSES, type Permission, type Principal, type Resource } from "@/authz";
import { firmToday } from "@/lib/dates";
import {
  cleanSpecialties,
  nextCode,
  ORG_CHART_LIMITS,
  ORG_CODE,
  ORG_UNIT_KINDS,
  type OrgChartRequestStatus,
  type OrgChartState,
  type OrgUnitKind,
  versionStatus,
  type VersionStatus,
} from "@/lib/org-chart";
import { structureChanges } from "@/lib/org-chart-changes";
import { BadRequestError, NotFoundError } from "@/server/errors";
import { audit } from "./audit";
import { putDepartmentMember } from "./engagement";
import { listFiles } from "./files";
import { isOverdue, listActions } from "./queries";

// The client's organisation structure (org chart, migration 0091). Part 1 of
// the feature: the reads, the edits, publishing, holders and suggestions the
// screens of the next pull requests call. The database holds every rule (who
// reads which version, who edits the draft, who publishes, who changes
// holders, whose names a reader sees, no cycles); these calls check the same
// permissions first for a clear answer and read everything under the
// person's own row-level security. Names are decided on the server: a holder
// the reader may not name arrives without a name (app_org_chart_holders), so
// a page never has a name to hide.
//
// Selah records the structure the firm decides. Nothing here suggests,
// scores or judges a structure, and nothing here grants or limits access to
// any work: a unit linked to a department is a label.

// ------------------------------------------------------------------ shapes

export interface OrgUnit {
  id: string;
  parentId: string | null;
  kind: OrgUnitKind;
  code: string;
  nameAr: string | null;
  nameEn: string | null;
  level: number;
  sortOrder: number;
  /** Drawn with a dotted line beside its parent (internal audit beside the chief executive). */
  advisory: boolean;
  /** The client's department it is linked to: a label only. */
  departmentId: string | null;
  departmentNameAr: string | null;
  departmentNameEn: string | null;
}

export interface OrgHolder {
  /** Null, with the name, the person and the dates, when the reader may not name this holder. */
  id: string | null;
  userId: string | null;
  name: string | null;
  from: string | null;
  to: string | null;
  named: boolean;
}

export interface OrgPosition {
  id: string;
  /** The same position across versions: holdings follow it. */
  lineageId: string;
  unitId: string;
  code: string;
  titleAr: string | null;
  titleEn: string | null;
  reportsToId: string | null;
  isHead: boolean;
  specialties: string[];
  plannedCount: number;
  sortOrder: number;
  holders: OrgHolder[];
  /** Nobody holds it on the day read. Null where the client keeps no names (minimal records): titles only. */
  vacant: boolean | null;
}

/** Whose names the reader sees: every one, her branch and the chain above it, or none. A hint for the screen; the database decides. */
export type NamesShown = "all" | "branch" | "none";

export interface OrgVersionSummary {
  id: string;
  state: OrgChartState;
  number: number | null;
  effectiveOn: string | null;
  publishedAt: Date | null;
  publishedByName: string | null;
  supersededAt: Date | null;
  resolutionDocumentId: string | null;
  showNames: boolean;
}

/** A position as the structure draws it, before holders are added. */
export type OrgPositionShape = Omit<OrgPosition, "holders" | "vacant">;

/** published_snapshot: the structure as published (app_org_chart_snapshot_of), no names. */
interface SnapshotV1 {
  format: 1;
  units: OrgUnit[];
  positions: OrgPositionShape[];
}

// ------------------------------------------------------------------ checks

const resource = (p: Principal, orgId: string, draft = false): Resource => ({
  type: "org_chart",
  orgId,
  firmOrgId: p.orgKind === "firm" ? p.orgId : undefined,
  projectId: null,
  draft,
});

const can = (p: Principal, permission: Permission, orgId: string, draft = false) => authorize(p, permission, resource(p, orgId, draft)).allowed;

/** The client, read under the caller's rights: another client is simply not there. */
async function clientOf(tx: Tx, clientOrgId: string) {
  const [org] = await tx
    .select({
      id: organizations.id,
      name: organizations.name,
      nameAr: organizations.nameAr,
      kind: organizations.kind,
      minimalRecords: organizations.minimalRecords,
      departmentsEnabled: organizations.departmentsEnabled,
      status: organizations.status,
    })
    .from(organizations)
    .where(eq(organizations.id, clientOrgId))
    .limit(1);
  if (!org || org.kind !== "client") throw new NotFoundError("client");
  return org;
}

type Client = Awaited<ReturnType<typeof clientOf>>;

async function chartOf(tx: Tx, clientOrgId: string) {
  const [chart] = await tx.select({ id: orgCharts.id }).from(orgCharts).where(eq(orgCharts.orgId, clientOrgId)).limit(1);
  return chart ?? null;
}

async function versionIn(tx: Tx, chartId: string, state: OrgChartState) {
  const [v] = await tx.select().from(orgChartVersions).where(and(eq(orgChartVersions.chartId, chartId), eq(orgChartVersions.state, state))).limit(1);
  return v ?? null;
}

/**
 * Who reads the whole history: every version, any day, every name and date (the firm's readers and
 * the client's admins). Anyone else reads the current version only, as of today, without dates
 * (the database decides: app_org_chart_holders).
 */
const readsHistory = (p: Principal) => p.orgKind === "firm" || p.role === "client_admin";

function namesShown(p: Principal, client: Client, version: { state: OrgChartState; showNames: boolean }): NamesShown {
  if (client.minimalRecords) return "none";
  if (readsHistory(p)) return "all";
  if (p.role === "client_manager" && version.state === "published" && version.showNames && client.departmentsEnabled && p.departmentIds.size > 0) return "branch";
  return "none";
}

/**
 * What the reader may do on the client's structure, for the screens. An
 * archived client's structure is read only, like its other client-level
 * records (check_client_open() refuses every write): nothing is offered to
 * anyone (S3 of the part 3 review).
 */
function abilities(p: Principal, client: Client) {
  const open = client.status !== "archived";
  return {
    canEditDraft: open && can(p, "org_chart.edit", client.id, true),
    canPublish: open && can(p, "org_chart.publish", client.id, true),
    canChangeHolders: open && !client.minimalRecords && can(p, "org_chart.holders", client.id),
    canSetShowNames: open && can(p, "org_chart.show_names", client.id),
    canSuggest: open && can(p, "org_chart_request.create", client.id),
  };
}

const trim = (s: string | null | undefined) => (s == null ? null : s.trim() || null);

function checkName(ar: string | null, en: string | null) {
  if (!ar && !en) throw new BadRequestError("name");
  if ((ar?.length ?? 0) > ORG_CHART_LIMITS.name || (en?.length ?? 0) > ORG_CHART_LIMITS.name) throw new BadRequestError("name_length");
}

function checkCode(code: string) {
  if (!ORG_CODE.test(code)) throw new BadRequestError("code");
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function checkDay(day: string) {
  if (!DAY.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00Z`))) throw new BadRequestError("date");
}

/** The calendar day before a day (YYYY-MM-DD). */
export function dayBefore(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** The calendar day after a day (YYYY-MM-DD). */
export function dayAfter(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// ------------------------------------------------------------------ reading

type HolderRow = { position_id: string; holder_id: string | null; user_id: string | null; name: string | null; from_date: string | null; to_date: string | null; named: boolean };

/** Who holds each position of a version on a day, with names only where the reader may see them (the database decides). */
async function holdersOf(tx: Tx, versionId: string, asOf: string) {
  const { rows } = await tx.execute<HolderRow>(sql`
    select position_id, holder_id, user_id, name, from_date::text as from_date, to_date::text as to_date, named
    from app_org_chart_holders(${versionId}::uuid, ${asOf}::date)`);
  const out = new Map<string, OrgHolder[]>();
  for (const r of rows) {
    out.set(r.position_id, [
      ...(out.get(r.position_id) ?? []),
      { id: r.holder_id, userId: r.user_id, name: r.name, from: r.from_date, to: r.to_date, named: r.named },
    ]);
  }
  return out;
}

/** A version's structure: the draft from its rows, a published version from its frozen snapshot. */
async function structureOf(tx: Tx, version: typeof orgChartVersions.$inferSelect): Promise<{ units: OrgUnit[]; positions: OrgPositionShape[] }> {
  if (version.state !== "draft" && version.publishedSnapshot) {
    const snap = version.publishedSnapshot as SnapshotV1;
    return { units: snap.units, positions: snap.positions };
  }
  const units = await tx
    .select({
      id: orgUnits.id,
      parentId: orgUnits.parentId,
      kind: orgUnits.kind,
      code: orgUnits.code,
      nameAr: orgUnits.nameAr,
      nameEn: orgUnits.nameEn,
      level: orgUnits.level,
      sortOrder: orgUnits.sortOrder,
      advisory: orgUnits.advisory,
      departmentId: orgUnits.departmentId,
      departmentNameAr: departments.nameAr,
      departmentNameEn: departments.nameEn,
    })
    .from(orgUnits)
    .leftJoin(departments, eq(departments.id, orgUnits.departmentId))
    .where(eq(orgUnits.versionId, version.id))
    .orderBy(asc(orgUnits.level), asc(orgUnits.sortOrder), asc(orgUnits.code));
  const rows = await tx
    .select({
      id: positions.id,
      lineageId: positions.lineageId,
      unitId: positions.unitId,
      code: positions.code,
      titleAr: positions.titleAr,
      titleEn: positions.titleEn,
      reportsToId: positions.reportsToId,
      isHead: positions.isHead,
      specialties: positions.specialties,
      plannedCount: positions.plannedCount,
      sortOrder: positions.sortOrder,
    })
    .from(positions)
    .where(eq(positions.versionId, version.id))
    .orderBy(asc(positions.sortOrder), asc(positions.code));
  return { units, positions: rows };
}

/**
 * A version's structure with who holds each position. Titles only where the reader keeps no names
 * (minimal records) or may not read this version's people (a client manager on an older version).
 */
async function withHolders(tx: Tx, principal: Principal, client: Client, version: typeof orgChartVersions.$inferSelect, asOf: string) {
  const { units, positions: rows } = await structureOf(tx, version);
  const titlesOnly = client.minimalRecords || (!readsHistory(principal) && version.state !== "published");
  const holders = titlesOnly ? new Map<string, OrgHolder[]>() : await holdersOf(tx, version.id, asOf);
  const list: OrgPosition[] = rows.map((r) => {
    const h = holders.get(r.id) ?? [];
    return { ...r, holders: h, vacant: titlesOnly ? null : h.length === 0 };
  });
  return { units, positions: list };
}

const publisher = alias(user, "publisher");

function summary(v: typeof orgChartVersions.$inferSelect, publishedByName: string | null): OrgVersionSummary {
  return {
    id: v.id,
    state: v.state,
    number: v.number,
    effectiveOn: v.effectiveOn,
    publishedAt: v.publishedAt,
    publishedByName,
    supersededAt: v.supersededAt,
    resolutionDocumentId: v.resolutionDocumentId,
    showNames: v.showNames,
  };
}

async function publisherName(tx: Tx, userId: string | null) {
  if (!userId) return null;
  const [u] = await tx.select({ name: publisher.name }).from(publisher).where(eq(publisher.id, userId)).limit(1);
  return u?.name ?? null;
}

/**
 * The client's current structure for the reader: every unit and position
 * title, and who holds each position today, named only where the reader may
 * see names (the firm and the client's admins: everyone; a manager: her
 * branch and the chain above it, while the version shows names). An action
 * owner, another client's people and any firm person outside the client get
 * a 404. Null `version` when nothing is published yet.
 */
export async function getPublishedChart(tx: Tx, principal: Principal, clientOrgId: string, today = firmToday()) {
  const client = await clientOf(tx, clientOrgId);
  assertAllowed(principal, "org_chart.read", resource(principal, client.id));
  const chart = await chartOf(tx, client.id);
  const version = chart ? await versionIn(tx, chart.id, "published") : null;
  const base = {
    client: { id: client.id, name: client.name, nameAr: client.nameAr, minimalRecords: client.minimalRecords },
    chartId: chart?.id ?? null,
    today,
    ...abilities(principal, client),
  };
  if (!version) return { ...base, version: null, names: "none" as NamesShown, units: [] as OrgUnit[], positions: [] as OrgPosition[] };
  const { units, positions: list } = await withHolders(tx, principal, client, version, today);
  return {
    ...base,
    version: summary(version, await publisherName(tx, version.publishedBy)),
    names: namesShown(principal, client, version),
    units,
    positions: list,
  };
}

export type PublishedChart = Awaited<ReturnType<typeof getPublishedChart>>;

/**
 * The firm's draft, with every name: for the firm's readers only (a client
 * person gets a 404). Null `draft` while the client has no structure yet;
 * `canStart` says whether the reader may start one.
 */
export async function getDraft(tx: Tx, principal: Principal, clientOrgId: string, today = firmToday()) {
  const client = await clientOf(tx, clientOrgId);
  assertAllowed(principal, "org_chart.read", resource(principal, client.id, true));
  const chart = await chartOf(tx, client.id);
  const draft = chart ? await versionIn(tx, chart.id, "draft") : null;
  const base = {
    client: { id: client.id, name: client.name, nameAr: client.nameAr, minimalRecords: client.minimalRecords },
    chartId: chart?.id ?? null,
    today,
    canStart: !chart && client.status !== "archived" && can(principal, "org_chart.edit", client.id, true),
    ...abilities(principal, client),
  };
  if (!draft) return { ...base, draft: null, units: [] as OrgUnit[], positions: [] as OrgPosition[] };
  const { units, positions: list } = await withHolders(tx, principal, client, draft, today);
  return { ...base, draft: { id: draft.id, basedOnId: draft.basedOnId, createdAt: draft.createdAt }, units, positions: list };
}

export type DraftChart = Awaited<ReturnType<typeof getDraft>>;

/**
 * What the outline editor offers besides the draft itself: the client's
 * active departments, which a unit may carry as a label (never an access
 * rule). For the firm's editors only.
 */
export async function editorChoices(tx: Tx, principal: Principal, clientOrgId: string) {
  const client = await clientOf(tx, clientOrgId);
  assertAllowed(principal, "org_chart.edit", resource(principal, client.id, true));
  const list = await tx
    .select({ id: departments.id, nameAr: departments.nameAr, nameEn: departments.nameEn })
    .from(departments)
    .where(and(eq(departments.orgId, client.id), eq(departments.active, true)))
    .orderBy(asc(departments.nameAr));
  return { departments: list };
}

/** Every version of the client's structure the reader may read, newest first: the draft (the firm only), the current one, the history. */
export async function listVersions(tx: Tx, principal: Principal, clientOrgId: string) {
  const client = await clientOf(tx, clientOrgId);
  assertAllowed(principal, "org_chart.read", resource(principal, client.id));
  const rows = await tx
    .select({ v: orgChartVersions, publishedByName: publisher.name })
    .from(orgChartVersions)
    .leftJoin(publisher, eq(publisher.id, orgChartVersions.publishedBy))
    .where(eq(orgChartVersions.orgId, client.id))
    .orderBy(sql`${orgChartVersions.number} desc nulls first`);
  return rows.map((r) => summary(r.v, r.publishedByName));
}

/**
 * One version as it was published (its frozen snapshot; the draft from its
 * rows, for the firm). For the firm's readers and the client's admins, with
 * who held each position on a day: today for the current version and the
 * draft, the day it was replaced for history, or `asOf`. For a client
 * manager, the current version as of today whatever `asOf` says, and older
 * versions as titles only (the database holds the same rule).
 */
export async function getVersion(tx: Tx, principal: Principal, versionId: string, asOf?: string) {
  const [version] = await tx.select().from(orgChartVersions).where(eq(orgChartVersions.id, versionId)).limit(1);
  if (!version) throw new NotFoundError("version");
  assertAllowed(principal, "org_chart.read", resource(principal, version.orgId, version.state === "draft"));
  const client = await clientOf(tx, version.orgId);
  if (asOf) checkDay(asOf);
  const day = !readsHistory(principal)
    ? firmToday()
    : (asOf ?? (version.state === "superseded" && version.supersededAt ? firmToday(version.supersededAt) : firmToday()));
  const { units, positions: list } = await withHolders(tx, principal, client, version, day);
  return {
    client: { id: client.id, name: client.name, nameAr: client.nameAr, minimalRecords: client.minimalRecords },
    version: summary(version, await publisherName(tx, version.publishedBy)),
    asOf: day,
    names: namesShown(principal, client, version),
    units,
    positions: list,
  };
}

/** Whether the reader may open the client's structure at all: the Structure tabs and the PDF. */
export const canReadStructure = (principal: Principal, clientOrgId: string) => can(principal, "org_chart.read", clientOrgId);

/**
 * Whether the Structure tab shows for the reader: they may read the client's
 * structure and there is something in it for them, a published version or,
 * for the firm, a draft with at least one unit. Until then there is no tab
 * and no empty page, except for the firm's editors (org chart, part 3): for
 * them the tab is where a structure is started, so it is always there. A
 * client person never learns of a draft: the database shows them published
 * versions only.
 */
export async function hasStructure(tx: Tx, principal: Principal, clientOrgId: string): Promise<boolean> {
  if (!UUID.test(clientOrgId) || !canReadStructure(principal, clientOrgId)) return false;
  if (principal.orgKind === "firm" && can(principal, "org_chart.edit", clientOrgId, true)) {
    // A client the firm cannot open is not there, whatever the policy says (row-level security decides).
    const [org] = await tx.select({ kind: organizations.kind, status: organizations.status }).from(organizations).where(eq(organizations.id, clientOrgId)).limit(1);
    // An archived client's structure is read only: nothing to start there (S3).
    if (org?.kind === "client" && org.status !== "archived") return true;
  }
  const firm = principal.orgKind === "firm";
  const { rows } = await tx.execute<{ ok: boolean }>(sql`
    select exists (
      select 1 from org_chart_versions v
      where v.org_id = ${clientOrgId}::uuid
        and (v.state <> 'draft' or (${firm} and exists (select 1 from org_units u where u.version_id = v.id)))
    ) as ok`);
  return rows[0]?.ok === true;
}

/** One version as the Structure tab and the PDF draw it. */
export interface StructureShown {
  version: OrgVersionSummary;
  /** Current, upcoming, replaced (when and by which) or the draft, on the day read. */
  status: VersionStatus;
  /** The day whose holders are shown. */
  asOf: string;
  names: NamesShown;
  units: OrgUnit[];
  positions: OrgPosition[];
}

/**
 * What the Structure tab and its PDF show: the version the reader picked
 * ("draft", a version's id, or nothing for the current one), read through
 * getPublishedChart, getDraft and getVersion, so the names, holders and dates
 * are exactly the ones those allow; nothing is decided again here. With
 * nothing picked: the current version or, for the firm while nothing is
 * published yet, its draft. The draft never reaches a client person (404),
 * nor does another client's version. `versions` is listVersions: the draft
 * only for the firm.
 */
export async function getStructure(tx: Tx, principal: Principal, clientOrgId: string, pick?: string | null, today = firmToday()) {
  const current = await getPublishedChart(tx, principal, clientOrgId, today);
  const listed = await listVersions(tx, principal, clientOrgId);
  const versions = listed.map((v) => ({ ...v, status: versionStatus(v, listed, today) }));
  const statusOf = (id: string) => versions.find((v) => v.id === id)!.status;
  const draftSummary = principal.orgKind === "firm" ? (versions.find((v) => v.state === "draft") ?? null) : null;
  const draft = async (): Promise<StructureShown> => {
    if (!draftSummary) throw new NotFoundError("draft");
    const d = await getDraft(tx, principal, clientOrgId, today);
    if (!d.draft || d.draft.id !== draftSummary.id) throw new NotFoundError("draft");
    return { version: draftSummary, status: { kind: "draft" }, asOf: today, names: current.client.minimalRecords ? "none" : "all", units: d.units, positions: d.positions };
  };
  let shown: StructureShown | null = null;
  if (pick === "draft") shown = await draft();
  else if (pick) {
    if (!UUID.test(pick) || !versions.some((v) => v.id === pick)) throw new NotFoundError("version");
    if (pick === draftSummary?.id) shown = await draft();
    else {
      const status = statusOf(pick);
      // A replaced version still in effect (its successor takes effect later) shows today's holders.
      const v = await getVersion(tx, principal, pick, status.kind === "current" ? today : undefined);
      shown = { version: v.version, status, asOf: v.asOf, names: v.names, units: v.units, positions: v.positions };
    }
  } else if (current.version) {
    shown = { version: current.version, status: statusOf(current.version.id), asOf: today, names: current.names, units: current.units, positions: current.positions };
  } else if (draftSummary) shown = await draft();
  const { departmentsEnabled } = await clientOf(tx, clientOrgId);
  // The board resolution of the version shown, when there is one and the reader may open the file (row-level security decides).
  const resolutionId = shown?.version.resolutionDocumentId ?? null;
  const [resolution] = resolutionId
    ? await tx.select({ id: documents.id, title: documents.title }).from(documents).where(eq(documents.id, resolutionId)).limit(1)
    : [];
  const can = {
    canEditDraft: current.canEditDraft,
    canPublish: current.canPublish,
    canChangeHolders: current.canChangeHolders,
    canSetShowNames: current.canSetShowNames,
    canSuggest: current.canSuggest,
  };
  return {
    client: { ...current.client, departmentsEnabled },
    today,
    current: current.version,
    versions,
    shown,
    resolution: resolution ?? null,
    draftId: draftSummary?.id ?? null,
    can,
  };
}

export type Structure = Awaited<ReturnType<typeof getStructure>>;

/**
 * Positions of the current structure nobody holds today (for the invite form
 * and the leaving flow). None at a client that keeps minimal records: its
 * structure has titles only.
 */
export async function listVacancies(tx: Tx, principal: Principal, clientOrgId: string, today = firmToday()) {
  const chart = await getPublishedChart(tx, principal, clientOrgId, today);
  if (!chart.version || chart.client.minimalRecords) return [];
  const units = new Map(chart.units.map((u) => [u.id, u]));
  return chart.positions
    .filter((p) => p.vacant)
    .map((p) => ({
      positionId: p.id,
      lineageId: p.lineageId,
      code: p.code,
      titleAr: p.titleAr,
      titleEn: p.titleEn,
      plannedCount: p.plannedCount,
      unitId: p.unitId,
      unitNameAr: units.get(p.unitId)?.nameAr ?? null,
      unitNameEn: units.get(p.unitId)?.nameEn ?? null,
    }));
}

/**
 * "Your manager", for a client person's profile: the position theirs reports
 * to on the current structure and who holds it today (or that it is vacant).
 * No other names; the name only while the version shows names (always for
 * the client's admin). Empty for firm staff and for someone who holds no
 * position.
 */
export async function myManager(tx: Tx, principal: Principal) {
  if (principal.orgKind !== "client") return [];
  const { rows } = await tx.execute<{
    my_position_id: string;
    position_id: string;
    code: string;
    title_ar: string | null;
    title_en: string | null;
    holder_name: string | null;
    vacant: boolean;
  }>(sql`select my_position_id, position_id, code, title_ar, title_en, holder_name, vacant from app_my_manager()`);
  return rows.map((r) => ({
    myPositionId: r.my_position_id,
    positionId: r.position_id,
    code: r.code,
    titleAr: r.title_ar,
    titleEn: r.title_en,
    name: r.holder_name,
    vacant: r.vacant,
  }));
}

// ------------------------------------------------------------------ the draft

/** Start the client's structure (the chart and its first draft): the firm's editors. Returns the existing one if there is one. */
export async function startChart(tx: Tx, principal: Principal, clientOrgId: string) {
  const client = await clientOf(tx, clientOrgId);
  assertAllowed(principal, "org_chart.edit", resource(principal, client.id, true));
  const existing = await chartOf(tx, client.id);
  if (existing) return { id: existing.id, created: false };
  const { rows } = await tx.execute<{ id: string }>(sql`select app_start_org_chart(${client.id}::uuid) as id`);
  const id = rows[0]!.id;
  await audit(tx, {
    actorId: principal.userId,
    orgId: principal.orgId,
    action: "org_chart.create",
    resourceType: "org_chart",
    resourceId: id,
    outcome: "allow",
    meta: { client: client.id },
  });
  return { id, created: true };
}

/** The client's draft, for an edit: the firm's editors only, everyone else a 404. */
async function draftOf(tx: Tx, principal: Principal, clientOrgId: string) {
  const client = await clientOf(tx, clientOrgId);
  assertAllowed(principal, "org_chart.edit", resource(principal, client.id, true));
  const chart = await chartOf(tx, client.id);
  const draft = chart ? await versionIn(tx, chart.id, "draft") : null;
  if (!chart || !draft) throw new NotFoundError("draft");
  return { client, chartId: chart.id, draft };
}

/** A unit for an edit: read under the caller's rights, the edit permission checked, and only in the draft. */
async function draftUnit(tx: Tx, principal: Principal, unitId: string) {
  const [row] = await tx
    .select({ unit: orgUnits, state: orgChartVersions.state })
    .from(orgUnits)
    .innerJoin(orgChartVersions, eq(orgChartVersions.id, orgUnits.versionId))
    .where(eq(orgUnits.id, unitId))
    .limit(1);
  if (!row) throw new NotFoundError("unit");
  assertAllowed(principal, "org_chart.edit", resource(principal, row.unit.orgId, true));
  if (row.state !== "draft") throw new BadRequestError("published");
  return row.unit;
}

async function draftPosition(tx: Tx, principal: Principal, positionId: string) {
  const [row] = await tx
    .select({ position: positions, state: orgChartVersions.state })
    .from(positions)
    .innerJoin(orgChartVersions, eq(orgChartVersions.id, positions.versionId))
    .where(eq(positions.id, positionId))
    .limit(1);
  if (!row) throw new NotFoundError("position");
  assertAllowed(principal, "org_chart.edit", resource(principal, row.position.orgId, true));
  if (row.state !== "draft") throw new BadRequestError("published");
  return row.position;
}

async function unitCodes(tx: Tx, versionId: string) {
  return new Set((await tx.select({ code: orgUnits.code }).from(orgUnits).where(eq(orgUnits.versionId, versionId))).map((r) => r.code));
}

async function positionCodes(tx: Tx, versionId: string) {
  return new Set((await tx.select({ code: positions.code }).from(positions).where(eq(positions.versionId, versionId))).map((r) => r.code));
}

async function checkDepartment(tx: Tx, clientOrgId: string, departmentId: string | null | undefined) {
  if (!departmentId) return;
  const [d] = await tx
    .select({ id: departments.id })
    .from(departments)
    .where(and(eq(departments.id, departmentId), eq(departments.orgId, clientOrgId), eq(departments.active, true)))
    .limit(1);
  if (!d) throw new BadRequestError("department");
}

/** Renumber siblings so `id` sits at `index` (the end when undefined). */
async function placeUnit(tx: Tx, versionId: string, parentId: string | null, id: string, index?: number) {
  const siblings = await tx
    .select({ id: orgUnits.id })
    .from(orgUnits)
    .where(and(eq(orgUnits.versionId, versionId), parentId ? eq(orgUnits.parentId, parentId) : sql`${orgUnits.parentId} is null`, ne(orgUnits.id, id)))
    .orderBy(asc(orgUnits.sortOrder), asc(orgUnits.code));
  const order = siblings.map((s) => s.id);
  order.splice(index === undefined ? order.length : Math.max(0, Math.min(index, order.length)), 0, id);
  for (const [i, sid] of order.entries()) await tx.update(orgUnits).set({ sortOrder: i }).where(eq(orgUnits.id, sid));
}

async function placePosition(tx: Tx, unitId: string, id: string, index?: number) {
  const siblings = await tx
    .select({ id: positions.id })
    .from(positions)
    .where(and(eq(positions.unitId, unitId), ne(positions.id, id)))
    .orderBy(asc(positions.sortOrder), asc(positions.code));
  const order = siblings.map((s) => s.id);
  order.splice(index === undefined ? order.length : Math.max(0, Math.min(index, order.length)), 0, id);
  for (const [i, sid] of order.entries()) await tx.update(positions).set({ sortOrder: i }).where(eq(positions.id, sid));
}

async function logEdit(tx: Tx, principal: Principal, action: string, resourceId: string, meta: Record<string, string | number | boolean | null>) {
  await audit(tx, { actorId: principal.userId, orgId: principal.orgId, action, resourceType: "org_chart", resourceId, outcome: "allow", meta });
}

export interface UnitInput {
  kind: OrgUnitKind;
  nameAr?: string | null;
  nameEn?: string | null;
  /** Given, it must be free in the draft; left out, the next free code under the parent ("2.4" gives "2.4.1"). */
  code?: string | null;
  /** Left out: one below the parent (1 at the top). */
  level?: number | null;
  advisory?: boolean;
  departmentId?: string | null;
}

/** Add a unit to the draft, under a parent of the draft or at the top. */
export async function addUnit(tx: Tx, principal: Principal, clientOrgId: string, input: UnitInput & { parentId?: string | null; index?: number }) {
  const { client, draft } = await draftOf(tx, principal, clientOrgId);
  if (!(ORG_UNIT_KINDS as readonly string[]).includes(input.kind)) throw new BadRequestError("kind");
  const nameAr = trim(input.nameAr);
  const nameEn = trim(input.nameEn);
  checkName(nameAr, nameEn);
  const parent = input.parentId ? await draftUnit(tx, principal, input.parentId) : null;
  if (parent && parent.versionId !== draft.id) throw new NotFoundError("unit");
  const taken = await unitCodes(tx, draft.id);
  const code = trim(input.code) ?? nextCode(parent?.code ?? null, taken);
  if (!code) throw new BadRequestError("code");
  checkCode(code);
  if (taken.has(code)) throw new BadRequestError("code_taken");
  const level = input.level ?? Math.min((parent?.level ?? 0) + 1, ORG_CHART_LIMITS.level.max);
  if (!Number.isInteger(level) || level < ORG_CHART_LIMITS.level.min || level > ORG_CHART_LIMITS.level.max) throw new BadRequestError("level");
  await checkDepartment(tx, client.id, input.departmentId);
  const [row] = await tx
    .insert(orgUnits)
    .values({
      versionId: draft.id,
      orgId: client.id,
      parentId: parent?.id ?? null,
      kind: input.kind,
      code,
      nameAr,
      nameEn,
      level,
      advisory: input.advisory ?? false,
      departmentId: input.departmentId ?? null,
      sortOrder: 0,
    })
    .returning({ id: orgUnits.id });
  await placeUnit(tx, draft.id, parent?.id ?? null, row!.id, input.index);
  await logEdit(tx, principal, "org_chart.unit_add", row!.id, { client: client.id, code });
  return { id: row!.id, code };
}

/** Rename a unit of the draft, or change its kind, code, level, advisory flag or department label. */
export async function updateUnit(tx: Tx, principal: Principal, unitId: string, input: Partial<UnitInput>) {
  const unit = await draftUnit(tx, principal, unitId);
  const set: Partial<typeof orgUnits.$inferInsert> = {};
  if (input.kind !== undefined) {
    if (!(ORG_UNIT_KINDS as readonly string[]).includes(input.kind)) throw new BadRequestError("kind");
    set.kind = input.kind;
  }
  if (input.nameAr !== undefined || input.nameEn !== undefined) {
    const nameAr = input.nameAr !== undefined ? trim(input.nameAr) : unit.nameAr;
    const nameEn = input.nameEn !== undefined ? trim(input.nameEn) : unit.nameEn;
    checkName(nameAr, nameEn);
    set.nameAr = nameAr;
    set.nameEn = nameEn;
  }
  if (input.code !== undefined) {
    const code = trim(input.code);
    if (!code) throw new BadRequestError("code");
    checkCode(code);
    if (code !== unit.code && (await unitCodes(tx, unit.versionId)).has(code)) throw new BadRequestError("code_taken");
    set.code = code;
  }
  if (input.level !== undefined && input.level !== null) {
    if (!Number.isInteger(input.level) || input.level < ORG_CHART_LIMITS.level.min || input.level > ORG_CHART_LIMITS.level.max) throw new BadRequestError("level");
    set.level = input.level;
  }
  if (input.advisory !== undefined) set.advisory = input.advisory;
  if (input.departmentId !== undefined) {
    await checkDepartment(tx, unit.orgId, input.departmentId);
    set.departmentId = input.departmentId;
  }
  if (!Object.keys(set).length) return { ok: true };
  await tx.update(orgUnits).set(set).where(eq(orgUnits.id, unitId));
  await logEdit(tx, principal, "org_chart.unit_update", unitId, { client: unit.orgId, fields: Object.keys(set).join(",") });
  return { ok: true };
}

/**
 * A unit moved under another parent keeps its place in the levels: it sits
 * one level below its new parent (level 1 at the top), and its own units
 * move by as many levels, within 1 to 12. The firm can still set a level by
 * hand afterwards (updateUnit).
 */
async function relevel(tx: Tx, unit: typeof orgUnits.$inferSelect, parentId: string | null) {
  const [parent] = parentId ? await tx.select({ level: orgUnits.level }).from(orgUnits).where(eq(orgUnits.id, parentId)).limit(1) : [];
  const shift = (parent?.level ?? 0) + 1 - unit.level;
  if (shift === 0) return;
  const { min, max } = ORG_CHART_LIMITS.level;
  await tx.execute(sql`
    with recursive sub (id) as (
      select ${unit.id}::uuid
      union
      select u.id from org_units u join sub on u.parent_id = sub.id
    )
    update org_units set level = least(${max}::int, greatest(${min}::int, level + ${shift}::int))
    where id in (select id from sub)`);
}

/**
 * Move a unit of the draft: under another unit of the draft (or to the top)
 * and to a place among its new siblings. Indenting, outdenting and moving up
 * or down are all this. Never under itself or one of its own units. Under a
 * new parent, its levels follow (relevel).
 */
export async function moveUnit(tx: Tx, principal: Principal, unitId: string, to: { parentId: string | null; index?: number }) {
  const unit = await draftUnit(tx, principal, unitId);
  if (to.parentId) {
    const parent = await draftUnit(tx, principal, to.parentId);
    if (parent.versionId !== unit.versionId) throw new NotFoundError("unit");
    // Walk up from the new parent: reaching the unit itself would make a loop.
    const parents = new Map(
      (await tx.select({ id: orgUnits.id, parentId: orgUnits.parentId }).from(orgUnits).where(eq(orgUnits.versionId, unit.versionId))).map((u) => [u.id, u.parentId]),
    );
    for (let at: string | null | undefined = to.parentId, n = 0; at && n <= parents.size; at = parents.get(at), n++) {
      if (at === unitId) throw new BadRequestError("cycle");
    }
  }
  if ((to.parentId ?? null) !== unit.parentId) {
    await tx.update(orgUnits).set({ parentId: to.parentId }).where(eq(orgUnits.id, unitId));
    await relevel(tx, unit, to.parentId);
  }
  await placeUnit(tx, unit.versionId, to.parentId, unitId, to.index);
  await logEdit(tx, principal, "org_chart.unit_move", unitId, { client: unit.orgId, parent: to.parentId });
  return { ok: true };
}

/** Remove an empty unit from the draft (move or remove its units and positions first). */
export async function deleteUnit(tx: Tx, principal: Principal, unitId: string) {
  const unit = await draftUnit(tx, principal, unitId);
  const { rows } = await tx.execute<{ n: number }>(sql`
    select (select count(*)::int from org_units c where c.parent_id = ${unitId}::uuid)
         + (select count(*)::int from positions p where p.unit_id = ${unitId}::uuid) as n`);
  if (Number(rows[0]?.n ?? 0) > 0) throw new BadRequestError("not_empty");
  await tx.delete(orgUnits).where(eq(orgUnits.id, unitId));
  await logEdit(tx, principal, "org_chart.unit_delete", unitId, { client: unit.orgId, code: unit.code });
  return { ok: true };
}

export interface PositionInput {
  titleAr?: string | null;
  titleEn?: string | null;
  /** Given, it must be free in the draft; left out, the next free code under the unit ("2.4" gives "2.4.1"). */
  code?: string | null;
  reportsToId?: string | null;
  isHead?: boolean;
  specialties?: string[];
  plannedCount?: number;
}

function checkSpecialties(list: string[]) {
  if (list.length > ORG_CHART_LIMITS.specialties.count || list.some((s) => s.length > ORG_CHART_LIMITS.specialties.length)) throw new BadRequestError("specialties");
}

function checkPlanned(n: number) {
  if (!Number.isInteger(n) || n < ORG_CHART_LIMITS.planned.min || n > ORG_CHART_LIMITS.planned.max) throw new BadRequestError("planned");
}

/** Whether pointing `positionId` at `reportsToId` would close a loop (walking up the lines from the new manager). */
async function wouldLoop(tx: Tx, versionId: string, positionId: string, reportsToId: string) {
  const lines = new Map(
    (await tx.select({ id: positions.id, reportsToId: positions.reportsToId }).from(positions).where(eq(positions.versionId, versionId))).map((p) => [p.id, p.reportsToId]),
  );
  for (let at: string | null | undefined = reportsToId, n = 0; at && n <= lines.size; at = lines.get(at), n++) {
    if (at === positionId) return true;
  }
  return false;
}

async function clearHead(tx: Tx, unitId: string, except: string) {
  await tx
    .update(positions)
    .set({ isHead: false })
    .where(and(eq(positions.unitId, unitId), eq(positions.isHead, true), ne(positions.id, except)));
}

/** Add a position to a unit of the draft. */
export async function addPosition(tx: Tx, principal: Principal, unitId: string, input: PositionInput & { index?: number }) {
  const unit = await draftUnit(tx, principal, unitId);
  const titleAr = trim(input.titleAr);
  const titleEn = trim(input.titleEn);
  checkName(titleAr, titleEn);
  const taken = await positionCodes(tx, unit.versionId);
  const code = trim(input.code) ?? nextCode(unit.code, taken);
  if (!code) throw new BadRequestError("code");
  checkCode(code);
  if (taken.has(code)) throw new BadRequestError("code_taken");
  const specialties = cleanSpecialties(input.specialties ?? []);
  checkSpecialties(specialties);
  const plannedCount = input.plannedCount ?? 1;
  checkPlanned(plannedCount);
  if (input.reportsToId) {
    const boss = await draftPosition(tx, principal, input.reportsToId);
    if (boss.versionId !== unit.versionId) throw new NotFoundError("position");
  }
  const id = randomUUID();
  await tx.insert(positions).values({
    id,
    lineageId: id,
    versionId: unit.versionId,
    orgId: unit.orgId,
    unitId,
    code,
    titleAr,
    titleEn,
    reportsToId: input.reportsToId ?? null,
    isHead: false,
    specialties,
    plannedCount,
    sortOrder: 0,
  });
  if (input.isHead) {
    await clearHead(tx, unitId, id);
    await tx.update(positions).set({ isHead: true }).where(eq(positions.id, id));
  }
  await placePosition(tx, unitId, id, input.index);
  await logEdit(tx, principal, "org_chart.position_add", id, { client: unit.orgId, code });
  return { id, code };
}

/** Change a position of the draft: its titles, code, whom it reports to, whether it heads its unit, its specialties, how many people it is planned for. */
export async function updatePosition(tx: Tx, principal: Principal, positionId: string, input: PositionInput) {
  const position = await draftPosition(tx, principal, positionId);
  const set: Partial<typeof positions.$inferInsert> = {};
  if (input.titleAr !== undefined || input.titleEn !== undefined) {
    const titleAr = input.titleAr !== undefined ? trim(input.titleAr) : position.titleAr;
    const titleEn = input.titleEn !== undefined ? trim(input.titleEn) : position.titleEn;
    checkName(titleAr, titleEn);
    set.titleAr = titleAr;
    set.titleEn = titleEn;
  }
  if (input.code !== undefined) {
    const code = trim(input.code);
    if (!code) throw new BadRequestError("code");
    checkCode(code);
    if (code !== position.code && (await positionCodes(tx, position.versionId)).has(code)) throw new BadRequestError("code_taken");
    set.code = code;
  }
  if (input.reportsToId !== undefined) {
    if (input.reportsToId) {
      if (input.reportsToId === positionId) throw new BadRequestError("cycle");
      const boss = await draftPosition(tx, principal, input.reportsToId);
      if (boss.versionId !== position.versionId) throw new NotFoundError("position");
      if (await wouldLoop(tx, position.versionId, positionId, input.reportsToId)) throw new BadRequestError("cycle");
    }
    set.reportsToId = input.reportsToId;
  }
  if (input.specialties !== undefined) {
    const specialties = cleanSpecialties(input.specialties);
    checkSpecialties(specialties);
    set.specialties = specialties;
  }
  if (input.plannedCount !== undefined) {
    checkPlanned(input.plannedCount);
    set.plannedCount = input.plannedCount;
  }
  if (input.isHead !== undefined) {
    if (input.isHead) await clearHead(tx, position.unitId, positionId);
    set.isHead = input.isHead;
  }
  if (!Object.keys(set).length) return { ok: true };
  await tx.update(positions).set(set).where(eq(positions.id, positionId));
  await logEdit(tx, principal, "org_chart.position_update", positionId, { client: position.orgId, fields: Object.keys(set).join(",") });
  return { ok: true };
}

/** Set whom a position of the draft reports to (null: no one). Never itself, even through others. */
export const setReportsTo = (tx: Tx, principal: Principal, positionId: string, reportsToId: string | null) =>
  updatePosition(tx, principal, positionId, { reportsToId });

/** Make a position of the draft its unit's head (the unit's previous head stops being it), or not. */
export const setHead = (tx: Tx, principal: Principal, positionId: string, isHead: boolean) => updatePosition(tx, principal, positionId, { isHead });

/** A position's specialties, trimmed, without blanks or repeats. */
export const setSpecialties = (tx: Tx, principal: Principal, positionId: string, specialties: string[]) =>
  updatePosition(tx, principal, positionId, { specialties });

/** Move a position of the draft to another unit of the draft (it stops heading its old one) and to a place among its new siblings. */
export async function movePosition(tx: Tx, principal: Principal, positionId: string, to: { unitId: string; index?: number }) {
  const position = await draftPosition(tx, principal, positionId);
  if (to.unitId !== position.unitId) {
    const unit = await draftUnit(tx, principal, to.unitId);
    if (unit.versionId !== position.versionId) throw new NotFoundError("unit");
    await tx.update(positions).set({ unitId: to.unitId, isHead: false }).where(eq(positions.id, positionId));
  }
  await placePosition(tx, to.unitId, positionId, to.index);
  await logEdit(tx, principal, "org_chart.position_move", positionId, { client: position.orgId, unit: to.unitId });
  return { ok: true };
}

/** Remove a position from the draft. Whoever reported to it reports to no one until the firm says (the database does it). */
export async function deletePosition(tx: Tx, principal: Principal, positionId: string) {
  const position = await draftPosition(tx, principal, positionId);
  await tx.delete(positions).where(eq(positions.id, positionId));
  await logEdit(tx, principal, "org_chart.position_delete", positionId, { client: position.orgId, code: position.code });
  return { ok: true };
}

// ------------------------------------------------------------------ publishing

// ------------------------------------------------------------------ publishing

/** What publishing does with a person planned for a position of the draft (app_org_chart_plan_outcomes). */
export type PlanOutcome = "place" | "left" | "holds" | "filled";

export interface PlannedPerson {
  positionId: string;
  code: string;
  userId: string | null;
  name: string | null;
  outcome: PlanOutcome;
  /** In a one-person position, who leaves it the day before the planned person takes it (changeHolder()'s rule). */
  leaving: string[];
}

type PlanRow = { position_id: string; code: string; user_id: string | null; name: string | null; outcome: PlanOutcome; leaving: string[] | null };
const plannedPerson = (r: PlanRow): PlannedPerson => ({
  positionId: r.position_id,
  code: r.code,
  userId: r.user_id,
  name: r.name,
  outcome: r.outcome,
  leaving: r.outcome === "place" ? (r.leaving ?? []) : [],
});

/** The plans of a draft as publishing on a day treats them; the draft's editors only (the database gives anyone else none). */
async function planOutcomes(tx: Tx, draftId: string, effectiveOn: string): Promise<PlannedPerson[]> {
  const { rows } = await tx.execute<PlanRow>(sql`
    select position_id, code, user_id, name, outcome, leaving from app_org_chart_plan_outcomes(${draftId}::uuid, ${effectiveOn}::date)`);
  return rows.map(plannedPerson);
}

/** The first day a new version may take effect: today, or the current version's day when that is later (never back-dated). */
export function earliestEffective(currentEffectiveOn: string | null, today: string): string {
  return currentEffectiveOn && currentEffectiveOn > today ? currentEffectiveOn : today;
}

/** A version's unit id as the draft copied from it holds it (app_org_chart_copy: md5 of the draft's id and the unit's). */
function copiedId(draftId: string, unitId: string): string {
  const h = createHash("md5").update(`${draftId}${unitId}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * The files the board resolution can be: the client's files the client can
 * see (shared, not archived), as the publisher reads them under their own
 * rights, so only a file they may open. Newest first.
 */
async function resolutionChoices(tx: Tx, clientOrgId: string) {
  return tx
    .select({ id: documents.id, title: documents.title, createdAt: documents.createdAt })
    .from(documents)
    .where(and(eq(documents.orgId, clientOrgId), eq(documents.visibility, "shared"), ne(documents.state, "archived")))
    .orderBy(desc(documents.createdAt))
    .limit(200);
}

/** Whether one file can be the board resolution: the client's, shared, not archived, and one the publisher may open. */
async function resolutionReadable(tx: Tx, clientOrgId: string, documentId: string) {
  const [d] = await tx
    .select({ id: documents.id })
    .from(documents)
    .where(and(eq(documents.id, documentId), eq(documents.orgId, clientOrgId), eq(documents.visibility, "shared"), ne(documents.state, "archived")))
    .limit(1);
  return !!d;
}

/**
 * What the publisher checks before publishing the draft (the publishing
 * screen): what changes against the version in effect (units and positions
 * added, moved, renamed and removed), the people whose positions the new
 * version drops and what happens to them on the day it takes effect (part
 * 3's rule: a holding that has started ends the day before; one that has not
 * started is cancelled), what happens to each person planned for the draft
 * (placed from that day, or skipped and why), and the files the board
 * resolution may be. For the firm admin, the lead and the deputy; anyone
 * else a 404. `draftId` is what the publisher must send back.
 */
export async function publishPreview(tx: Tx, principal: Principal, clientOrgId: string, effectiveOn?: string | null, today = firmToday()) {
  const client = await clientOf(tx, clientOrgId);
  assertAllowed(principal, "org_chart.publish", resource(principal, client.id, true));
  if (effectiveOn) checkDay(effectiveOn);
  const chart = await chartOf(tx, client.id);
  const draft = chart ? await versionIn(tx, chart.id, "draft") : null;
  if (!chart || !draft) throw new NotFoundError("draft");
  const current = await versionIn(tx, chart.id, "published");
  const after = await structureOf(tx, draft);
  const before = current ? await structureOf(tx, current) : { units: [], positions: [] };
  const changes = structureChanges(before, after, (draftUnitId) => before.units.find((u) => copiedId(draft.id, u.id) === draftUnitId)?.id ?? null);
  // The day the new version takes effect: the one asked, else the earliest allowed, which is today or
  // the current version's day if later (never back-dated: review B1).
  const earliest = earliestEffective(current?.effectiveOn ?? null, today);
  const on = effectiveOn && effectiveOn >= earliest ? effectiveOn : earliest;
  const lastDay = dayBefore(on);
  // Part 3's rule as publishing applies it (close_dropped_holdings): started by today ends, never deleted.
  const startedBy = lastDay > today ? lastDay : today;
  const dropped = new Set(changes.positions.removed.map((p) => p.lineageId));
  const leaving = dropped.size
    ? await tx
        .select({ lineage: positionHolders.positionLineageId, userId: positionHolders.userId, typed: positionHolders.name, userName: user.name, from: positionHolders.fromDate })
        .from(positionHolders)
        .leftJoin(user, eq(user.id, positionHolders.userId))
        .where(
          and(
            eq(positionHolders.chartId, chart.id),
            inArray(positionHolders.positionLineageId, [...dropped]),
            sql`(${positionHolders.toDate} is null or ${positionHolders.toDate} > ${lastDay}::date)`,
          ),
        )
        .orderBy(asc(positionHolders.fromDate))
    : [];
  const removedBy = new Map(changes.positions.removed.map((p) => [p.lineageId, p]));
  return {
    client: { id: client.id, name: client.name, nameAr: client.nameAr, minimalRecords: client.minimalRecords },
    draftId: draft.id,
    /** The draft as shown here (its units, positions and plans): publishing with it is refused once the draft changes (review N2). */
    revision: (await tx.execute<{ r: string | null }>(sql`select app_org_chart_draft_revision(${draft.id}::uuid) as r`)).rows[0]?.r ?? null,
    hasUnits: after.units.length > 0,
    current: current ? summary(current, await publisherName(tx, current.publishedBy)) : null,
    nextNumber: (current?.number ?? 0) + 1,
    today,
    effectiveOn: on,
    earliest,
    changes,
    /** People on positions the new version drops: their holding ends the day before it takes effect, or, not started yet, is cancelled. */
    dropped: leaving.map((h) => {
      const p = removedBy.get(h.lineage)!;
      const cancelled = h.from > startedBy;
      return { code: p.code, titleAr: p.titleAr, titleEn: p.titleEn, name: h.typed ?? h.userName, endsOn: cancelled ? null : h.from > lastDay ? h.from : lastDay, cancelled };
    }),
    plans: client.minimalRecords ? [] : await planOutcomes(tx, draft.id, on),
    resolutions: await resolutionChoices(tx, client.id),
  };
}

export type PublishPreview = Awaited<ReturnType<typeof publishPreview>>;

/**
 * Publish the draft (the firm admin, the lead or the deputy) with the day it
 * takes effect, on or after the current version's, and, optionally, the
 * board resolution (a file of the client that the client can see and the
 * publisher may open). The current version becomes history, the draft
 * becomes current with its structure frozen, and a copy becomes the next
 * draft. Holdings of positions the new structure drops end the day before it
 * takes effect (part 3). The people planned for the draft's positions are
 * placed in them from that day, each checked again first: someone who is no
 * longer one of the client's active people, or already holds the position,
 * is skipped and listed; the plans are then cleared, and the client's lead
 * and deputy are told (the database does it all: app_publish_org_chart).
 * `draftId` is the draft the publisher checked (getDraft's or
 * publishPreview's `draftId`): once it is published, or for any id that is
 * not this client's draft, publishing is refused ("this draft is no longer
 * the current one", orgChart.errors draftChanged), so two publishers at the
 * same moment make one version. A malformed id is a bad request.
 */
export async function publish(
  tx: Tx,
  principal: Principal,
  clientOrgId: string,
  input: { draftId: string; effectiveOn: string; resolutionDocumentId?: string | null; revision?: string | null },
) {
  const client = await clientOf(tx, clientOrgId);
  assertAllowed(principal, "org_chart.publish", resource(principal, client.id, true));
  checkDay(input.effectiveOn);
  if (!UUID.test(input.draftId ?? "")) throw new BadRequestError("draft_id");
  const chart = await chartOf(tx, client.id);
  if (!chart) throw new NotFoundError("draft");
  const current = await versionIn(tx, chart.id, "published");
  if (input.effectiveOn < earliestEffective(current?.effectiveOn ?? null, firmToday())) throw new BadRequestError("effective_before");
  const resolution = input.resolutionDocumentId ?? null;
  // The publisher may open the file (read under their rights), whatever its age (review N3).
  if (resolution && (!UUID.test(resolution) || !(await resolutionReadable(tx, client.id, resolution)))) throw new BadRequestError("resolution");
  // The database works out who is placed inside its lock and says so (review N1); with the screen's revision,
  // it refuses a draft that changed since it was shown (review N2).
  const { rows } = await tx.execute<{ out: { version: string; number: number; plans: PlanRow[] } }>(
    sql`select app_publish_org_chart_checked(${chart.id}::uuid, ${input.draftId}::uuid, ${input.revision ?? null}::text, ${input.effectiveOn}::date, ${resolution}::uuid) as out`,
  );
  const out = rows[0]!.out;
  const id = out.version;
  const v = { number: out.number };
  const planned = out.plans.map(plannedPerson);
  const placed = planned.filter((x) => x.outcome === "place");
  const skipped = planned.filter((x) => x.outcome !== "place");
  await audit(tx, {
    actorId: principal.userId,
    orgId: principal.orgId,
    action: "org_chart.publish",
    resourceType: "org_chart",
    resourceId: id,
    outcome: "allow",
    meta: { client: client.id, number: v?.number ?? null, effectiveOn: input.effectiveOn, resolution, placed: placed.length, skipped: skipped.length },
  });
  return { versionId: id, number: v?.number ?? null, placed, skipped };
}

/**
 * Start the draft again from the current published version (the firm's
 * editors): the draft's units and positions are replaced by a copy of what
 * is published. `draftId` is the draft the editor looked at, as for
 * publishing; any other id is refused (orgChart.errors draftChanged).
 */
export async function resetDraft(tx: Tx, principal: Principal, clientOrgId: string, input: { draftId: string }) {
  const { chartId, draft } = await draftOf(tx, principal, clientOrgId);
  if (!UUID.test(input.draftId ?? "")) throw new BadRequestError("draft_id");
  // What is lost, for the audit row (S2): the draft's units and positions, and how many positions only the draft had.
  const { rows } = await tx.execute<{ units: number; positions: number; draft_only: number }>(sql`
    select (select count(*)::int from org_units u where u.version_id = ${draft.id}::uuid) as units,
           (select count(*)::int from positions p where p.version_id = ${draft.id}::uuid) as positions,
           (select count(*)::int from positions p where p.version_id = ${draft.id}::uuid and p.lineage_id = p.id) as draft_only`);
  await tx.execute(sql`select app_reset_org_chart_draft(${chartId}::uuid, ${input.draftId}::uuid)`);
  const lost = rows[0]!;
  await logEdit(tx, principal, "org_chart.draft_reset", draft.id, {
    client: clientOrgId,
    units: lost.units,
    positions: lost.positions,
    draftOnlyPositions: lost.draft_only,
  });
  return { ok: true };
}

/** The client admin's switch: whether the client's managers see names on a published (or past) version at all. */
export async function setShowNames(tx: Tx, principal: Principal, versionId: string, on: boolean) {
  const [version] = await tx.select().from(orgChartVersions).where(eq(orgChartVersions.id, versionId)).limit(1);
  if (!version) throw new NotFoundError("version");
  assertAllowed(principal, "org_chart.show_names", resource(principal, version.orgId, version.state === "draft"));
  await tx.execute(sql`select app_set_org_chart_show_names(${versionId}::uuid, ${on})`);
  await audit(tx, {
    actorId: principal.userId,
    orgId: principal.orgId,
    action: "org_chart.show_names",
    resourceType: "org_chart",
    resourceId: versionId,
    outcome: "allow",
    meta: { client: version.orgId, on },
  });
  return { ok: true };
}

// ------------------------------------------------------------------ people in positions

export interface HolderChange {
  /** Who now holds the position, from which day: one of the client's people with an account, or a typed name. */
  start?: { userId?: string | null; name?: string | null; from: string };
  /**
   * The holding that ends, and its last day. Left out with `start` on a
   * position planned for one person, whoever still holds it stops the day
   * before `start.from` (refused when they started on or after that day).
   */
  end?: { holderId: string; on: string };
}

/**
 * Change who holds a position: someone joined, left, or replaces the person
 * there. Only on the live structure, the current published version: the
 * client's admin and the firm's editors (part 1), never from the firm's
 * draft (the lead's decision B1, part 3: a draft never shows the company a
 * planned successor; the database refuses it too). Every change is audited
 * and tells the client's lead and deputy (the database does it). Nobody's
 * history is deleted: a holding ends.
 */
export async function changeHolder(tx: Tx, principal: Principal, positionId: string, change: HolderChange) {
  const [row] = await tx
    .select({ position: positions, state: orgChartVersions.state, chartId: orgChartVersions.chartId })
    .from(positions)
    .innerJoin(orgChartVersions, eq(orgChartVersions.id, positions.versionId))
    .where(eq(positions.id, positionId))
    .limit(1);
  if (!row) throw new NotFoundError("position");
  const { position, state, chartId } = row;
  assertAllowed(principal, "org_chart.holders", resource(principal, position.orgId, state === "draft"));
  if (state === "draft") throw new BadRequestError("draft");
  if (state === "superseded") throw new BadRequestError("history");
  const client = await clientOf(tx, position.orgId);
  if (client.minimalRecords) throw new BadRequestError("minimal_records");
  if (!change.start && !change.end) throw new BadRequestError("nothing");

  const ended: string[] = [];
  const endOne = async (holderId: string, on: string) => {
    checkDay(on);
    const updated = await tx
      .update(positionHolders)
      .set({ toDate: on })
      .where(and(eq(positionHolders.id, holderId), eq(positionHolders.positionLineageId, position.lineageId), sql`${positionHolders.toDate} is null`))
      .returning({ id: positionHolders.id });
    if (!updated.length) throw new NotFoundError("holder");
    ended.push(holderId);
    await audit(tx, {
      actorId: principal.userId,
      orgId: principal.orgId,
      action: "org_chart.holder_end",
      resourceType: "org_chart",
      resourceId: positionId,
      outcome: "allow",
      meta: { client: position.orgId, holder: holderId, on },
    });
  };

  if (change.end) await endOne(change.end.holderId, change.end.on);

  let started: string | null = null;
  if (change.start) {
    const { from } = change.start;
    checkDay(from);
    const userId = change.start.userId ?? null;
    const name = trim(change.start.name);
    if ((userId === null) === (name === null)) throw new BadRequestError("holder");
    if (name && (name.length < ORG_CHART_LIMITS.holderName.min || name.length > ORG_CHART_LIMITS.holderName.max)) throw new BadRequestError("holder_name");
    if (!change.end && position.plannedCount === 1) {
      // Whoever still holds the one-person position hands it over the day before.
      const current = await tx
        .select({ id: positionHolders.id, fromDate: positionHolders.fromDate })
        .from(positionHolders)
        .where(and(eq(positionHolders.positionLineageId, position.lineageId), sql`${positionHolders.toDate} is null`));
      for (const h of current) {
        if (h.fromDate >= from) throw new BadRequestError("overlap");
        await endOne(h.id, dayBefore(from));
      }
    }
    const [inserted] = await tx
      .insert(positionHolders)
      .values({
        positionLineageId: position.lineageId,
        chartId,
        orgId: position.orgId,
        userId,
        name,
        fromDate: from,
        createdBy: principal.userId,
      })
      .returning({ id: positionHolders.id });
    started = inserted!.id;
    await audit(tx, {
      actorId: principal.userId,
      orgId: principal.orgId,
      action: "org_chart.holder_start",
      resourceType: "org_chart",
      resourceId: positionId,
      outcome: "allow",
      meta: { client: position.orgId, holder: started, from, typed: name !== null },
    });
  }
  return { started, ended };
}

/**
 * A position for the people in it: the version it is in, read under the
 * caller's rights, and the holders permission checked. Only a position of the
 * live structure (never the draft's, B1).
 */
async function holderPosition(tx: Tx, principal: Principal, positionId: string, opts: { dropped?: boolean } = {}) {
  const [row] = await tx
    .select({ position: positions, state: orgChartVersions.state, chartId: orgChartVersions.chartId })
    .from(positions)
    .innerJoin(orgChartVersions, eq(orgChartVersions.id, positions.versionId))
    .where(eq(positions.id, positionId))
    .limit(1);
  if (!row) throw new NotFoundError("position");
  assertAllowed(principal, "org_chart.holders", resource(principal, row.position.orgId, row.state === "draft"));
  if (row.state === "draft") throw new BadRequestError("draft");
  // A position of an earlier version: only one the current version dropped (S1), and only where that is asked for.
  if (row.state === "superseded" && !(opts.dropped && !(await onCurrentVersion(tx, row.chartId, row.position.lineageId)))) throw new BadRequestError("history");
  const client = await clientOf(tx, row.position.orgId);
  if (client.minimalRecords) throw new BadRequestError("minimal_records");
  return { ...row, client };
}

export interface Holding {
  id: string;
  userId: string | null;
  /** The person's name, or the name typed in. */
  name: string | null;
  /** Typed in: no Selah account. */
  typed: boolean;
  from: string;
  to: string | null;
  /** Holds it on the day read. */
  current: boolean;
  /** Starts on a coming day. */
  upcoming: boolean;
}

/**
 * Everyone who holds or held a position, newest first, with the dates: for
 * the people who change holders (the client's admin on the published
 * structure, the firm's editors there and in the draft). Read under their
 * own row-level security.
 */
export async function listHoldings(tx: Tx, principal: Principal, positionId: string, today = firmToday()) {
  const { position, state } = await holderPosition(tx, principal, positionId);
  const rows = await tx
    .select({
      id: positionHolders.id,
      userId: positionHolders.userId,
      typedName: positionHolders.name,
      userName: user.name,
      from: positionHolders.fromDate,
      to: positionHolders.toDate,
    })
    .from(positionHolders)
    .leftJoin(user, eq(user.id, positionHolders.userId))
    .where(eq(positionHolders.positionLineageId, position.lineageId))
    .orderBy(desc(positionHolders.fromDate), desc(positionHolders.createdAt));
  const holdings: Holding[] = rows.map((r) => ({
    id: r.id,
    userId: r.userId,
    name: r.typedName ?? r.userName,
    typed: r.typedName !== null,
    from: r.from,
    to: r.to,
    current: r.from <= today && (r.to === null || r.to >= today),
    upcoming: r.from > today,
  }));
  return {
    position: { id: position.id, code: position.code, titleAr: position.titleAr, titleEn: position.titleEn, plannedCount: position.plannedCount, draft: state === "draft" },
    today,
    holdings,
  };
}

/**
 * Remove a holding entered by mistake (a typo, the wrong person), for the
 * people who may change holders. Unlike ending one, it is deleted: the name
 * is gone from the structure, its history and the masking list, and once no
 * holding names anyone, the client may switch to minimal records again. The
 * audit log records that a holding was removed from this position, by whom
 * and when, never the name (the database does it: app_remove_position_holder).
 * A change on the published structure tells the lead and deputy.
 */
export async function removeHolder(tx: Tx, principal: Principal, positionId: string, holderId: string) {
  await holderPosition(tx, principal, positionId, { dropped: true });
  if (!UUID.test(holderId)) throw new NotFoundError("holder");
  await tx.execute(sql`select app_remove_position_holder(${positionId}::uuid, ${holderId}::uuid)`);
  return { ok: true };
}

/** Whether a position (its lineage) is on the chart's current published version. */
async function onCurrentVersion(tx: Tx, chartId: string, lineageId: string) {
  const { rows } = await tx.execute<{ yes: boolean }>(sql`
    select exists (
      select 1 from positions p join org_chart_versions v on v.id = p.version_id
      where v.chart_id = ${chartId}::uuid and v.state = 'published' and p.lineage_id = ${lineageId}::uuid
    ) as yes`);
  return rows[0]?.yes === true;
}

/**
 * Names still kept on positions a later version dropped (S1 of the part 3
 * review): publishing ended those holdings, but they still name someone, so
 * a client that restructured could never switch to minimal records. For the
 * people who change holders, each with the position as it last stood (its
 * row in the latest version that had it), so the same removal (asked first,
 * audited without the name) takes it away.
 */
export async function droppedHoldings(tx: Tx, principal: Principal, clientOrgId: string) {
  const client = await clientOf(tx, clientOrgId);
  assertAllowed(principal, "org_chart.holders", resource(principal, client.id));
  const chart = await chartOf(tx, client.id);
  if (!chart) return [];
  const { rows } = await tx.execute<{
    holder_id: string;
    user_id: string | null;
    typed_name: string | null;
    user_name: string | null;
    from_date: string;
    to_date: string | null;
    position_id: string;
    code: string;
    title_ar: string | null;
    title_en: string | null;
  }>(sql`
    select h.id as holder_id, h.user_id, h.name as typed_name, u.name as user_name, h.from_date::text as from_date, h.to_date::text as to_date,
      last.id as position_id, last.code, last.title_ar, last.title_en
    from position_holders h
    left join "user" u on u.id = h.user_id
    cross join lateral (
      select p.id, p.code, p.title_ar, p.title_en from positions p join org_chart_versions v on v.id = p.version_id
      where p.lineage_id = h.position_lineage_id and v.chart_id = ${chart.id}::uuid and v.state = 'superseded'
      order by v.number desc limit 1
    ) last
    where h.chart_id = ${chart.id}::uuid
      and not exists (
        select 1 from positions c join org_chart_versions cv on cv.id = c.version_id
        where c.lineage_id = h.position_lineage_id and cv.chart_id = ${chart.id}::uuid and cv.state = 'published'
      )
    order by last.code, h.from_date`);
  return rows.map((r) => ({
    holderId: r.holder_id,
    positionId: r.position_id,
    code: r.code,
    titleAr: r.title_ar,
    titleEn: r.title_en,
    userId: r.user_id,
    name: r.typed_name ?? r.user_name,
    typed: r.typed_name !== null,
    from: r.from_date,
    to: r.to_date,
  }));
}

export type DroppedHolding = Awaited<ReturnType<typeof droppedHoldings>>[number];

/** The client's people with an account, who can be placed in a position: for the people who change holders. */
export async function holderCandidates(tx: Tx, principal: Principal, clientOrgId: string) {
  const client = await clientOf(tx, clientOrgId);
  assertAllowed(principal, "org_chart.holders", resource(principal, client.id));
  if (client.minimalRecords) return [];
  return tx
    .select({ userId: user.id, name: user.name, email: user.email })
    .from(orgMemberships)
    .innerJoin(user, eq(user.id, orgMemberships.userId))
    .where(and(eq(orgMemberships.orgId, client.id), eq(orgMemberships.active, true), inArray(orgMemberships.role, [...CLIENT_ROLES])))
    .orderBy(asc(user.name));
}

/**
 * What someone of a client holds or is due to hold on its current structure,
 * for the leaving report: each holding that has started and is not over
 * (also one with a later end date: it ends on the leaving day, "leave
 * vacant" or "pick a replacement"), and each that has not started yet
 * (`cancelled`, from `startsOn`: it is cancelled when the account is
 * switched off; B2). Empty when the reader may not change holders there, or
 * the client has no published structure.
 */
export async function positionsHeldBy(tx: Tx, principal: Principal, clientOrgId: string, userId: string, today = firmToday()) {
  if (!can(principal, "org_chart.holders", clientOrgId)) return [];
  // The firm's own people hold no positions: only a client has a structure.
  const client = await clientOf(tx, clientOrgId).catch((e) => (e instanceof NotFoundError ? null : Promise.reject(e)));
  if (!client || client.minimalRecords) return [];
  const chart = await chartOf(tx, client.id);
  const version = chart ? await versionIn(tx, chart.id, "published") : null;
  if (!version) return [];
  const { units, positions: list } = await structureOf(tx, version);
  const held = await tx
    .select({ id: positionHolders.id, lineage: positionHolders.positionLineageId, from: positionHolders.fromDate })
    .from(positionHolders)
    .where(
      and(
        eq(positionHolders.orgId, client.id),
        eq(positionHolders.userId, userId),
        sql`(${positionHolders.toDate} is null or ${positionHolders.toDate} > ${today}::date)`,
      ),
    )
    .orderBy(asc(positionHolders.fromDate));
  const unitOf = new Map(units.map((u) => [u.id, u]));
  // A holding on a position the current version dropped (it runs until the day before a later effective
  // date): the position as it last stood, so the report lists everything the switch-off ends or cancels (N2).
  const missing = [...new Set(held.filter((h) => !list.some((x) => x.lineageId === h.lineage)).map((h) => h.lineage))];
  const lastRows = new Map<string, { id: string; code: string; titleAr: string | null; titleEn: string | null; plannedCount: number }>();
  if (missing.length) {
    const { rows } = await tx.execute<{ lineage_id: string; id: string; code: string; title_ar: string | null; title_en: string | null; planned_count: number }>(sql`
      select distinct on (p.lineage_id) p.lineage_id, p.id, p.code, p.title_ar, p.title_en, p.planned_count
      from positions p join org_chart_versions v on v.id = p.version_id
      where v.chart_id = ${chart!.id}::uuid and v.state = 'superseded' and p.lineage_id in (${sql.join(
        missing.map((m) => sql`${m}::uuid`),
        sql`, `,
      )})
      order by p.lineage_id, v.number desc`);
    for (const r of rows) lastRows.set(r.lineage_id, { id: r.id, code: r.code, titleAr: r.title_ar, titleEn: r.title_en, plannedCount: r.planned_count });
  }
  return held.flatMap((h) => {
    const current = list.find((x) => x.lineageId === h.lineage);
    const p = current ?? lastRows.get(h.lineage);
    if (!p) return [];
    const u = current ? unitOf.get(current.unitId) : undefined;
    const cancelled = h.from > today;
    return [
      {
        positionId: p.id,
        holderId: h.id,
        code: p.code,
        titleAr: p.titleAr,
        titleEn: p.titleEn,
        unitNameAr: u?.nameAr ?? null,
        unitNameEn: u?.nameEn ?? null,
        plannedCount: p.plannedCount,
        /** Not started yet: cancelled when the account is switched off, never replaced. */
        cancelled,
        startsOn: cancelled ? h.from : null,
        /** On a position the current version no longer has: it ends on the leaving day, never replaced. */
        dropped: !current,
      },
    ];
  });
}

/**
 * Whether a one-person position already has someone scheduled to start on
 * or after a day (the leaving flow's replacement would overlap them).
 */
export async function successorScheduled(tx: Tx, positionId: string, from: string) {
  const { rows } = await tx.execute<{ yes: boolean }>(sql`
    select exists (
      select 1 from positions p join position_holders h on h.position_lineage_id = p.lineage_id
      where p.id = ${positionId}::uuid and p.planned_count = 1 and h.from_date >= ${from}::date
    ) as yes`);
  return rows[0]?.yes === true;
}

/**
 * The lineage of a vacant position of the client's current structure, for an
 * invitation that fills it (the invite form's "Position"). Refused (a bad
 * request) for a position that is not vacant today or not on the current
 * structure, and for someone who may not change holders there.
 */
export async function vacancyLineage(tx: Tx, principal: Principal, clientOrgId: string, positionId: string) {
  if (!can(principal, "org_chart.holders", clientOrgId)) throw new BadRequestError("position");
  const vacancy = (await listVacancies(tx, principal, clientOrgId)).find((v) => v.positionId === positionId);
  if (!vacancy) throw new BadRequestError("position");
  return vacancy.lineageId;
}

// ------------------------------------------------------------------ a person's work card

/** How many of each a card lists: it is a glance, not a report. */
export const WORK_CARD_ROWS = 5;

export interface WorkAction {
  id: string;
  title: string;
  status: string;
  dueDate: string | null;
  projectTitle: string;
}

export interface WorkFile {
  id: string;
  title: string;
  createdAt: string;
  /** Where the file belongs: its action, meeting, assessment or project. */
  href: string;
  where: string;
}

/**
 * A person's work card (Fahad, 18 Nov): clicking a person on the drawn
 * structure shows their open tasks, what is late, and their recent uploads,
 * each linking to the item. It opens only where the reader already sees this
 * person's name on the version they are looking at (getStructure, read as
 * them: the manager's branch rule, show names, minimal records all apply; a
 * typed name has no account and no card), and everything on it is read as
 * the reader, through the same services and row-level security as the
 * Actions page and the Files card. Nothing is read on anyone else's behalf.
 * It lists the work: no score, count, ranking or colour about the person.
 */
export async function personWork(tx: Tx, principal: Principal, clientOrgId: string, userId: string, pick?: string | null, today = firmToday()) {
  if (!UUID.test(userId)) throw new NotFoundError("person");
  const structure = await getStructure(tx, principal, clientOrgId, pick ?? null, today);
  const shown = structure.shown;
  const held = (shown?.positions ?? []).filter((p) => p.holders.some((h) => h.named && h.userId === userId && h.name));
  if (!shown || !held.length) throw new NotFoundError("person");
  const name = held[0]!.holders.find((h) => h.userId === userId)!.name!;
  const unitOf = new Map(shown.units.map((u) => [u.id, u]));

  const actionsOpen = await listActions(tx, principal, { clientOrgId, ownerUserId: userId, status: [...OPEN_STATUSES], liveProjects: true });
  const work = actionsOpen.map((a) => ({ id: a.id, title: a.title, status: a.status, dueDate: a.dueDate, projectTitle: a.projectTitle, late: isOverdue(a, today) }));
  const late = work.filter((w) => w.late);
  const open = work.filter((w) => !w.late);
  const files = (await listFiles(tx, principal, { uploadedBy: userId, orgId: clientOrgId, limit: WORK_CARD_ROWS * 4 })).slice(0, WORK_CARD_ROWS);
  const strip = (a: (typeof work)[number]): WorkAction => ({ id: a.id, title: a.title, status: a.status, dueDate: a.dueDate, projectTitle: a.projectTitle });

  return {
    person: {
      userId,
      name,
      positions: held.map((p) => ({
        code: p.code,
        titleAr: p.titleAr,
        titleEn: p.titleEn,
        unitNameAr: unitOf.get(p.unitId)?.nameAr ?? null,
        unitNameEn: unitOf.get(p.unitId)?.nameEn ?? null,
      })),
    },
    late: late.slice(0, WORK_CARD_ROWS).map(strip),
    open: open.slice(0, WORK_CARD_ROWS).map(strip),
    /** Some were left off a list (the ones due soonest are shown), each list on its own. Never how many. */
    more: late.length > WORK_CARD_ROWS || open.length > WORK_CARD_ROWS,
    moreLate: late.length > WORK_CARD_ROWS,
    moreOpen: open.length > WORK_CARD_ROWS,
    uploads: files.map(
      (f): WorkFile => ({
        id: f.id,
        title: f.title,
        createdAt: f.createdAt,
        href:
          f.source.kind === "evidence" && f.source.id
            ? `/actions/${f.source.id}`
            : f.source.kind === "meeting"
              ? `/meetings/${f.source.id}`
              : f.source.kind === "assessment"
                ? `/assessments/${f.source.id}`
                : `/projects/${f.project.id}`,
        where: "title" in f.source && f.source.title ? f.source.title : f.project.title,
      }),
    ),
  };
}

export type PersonWork = Awaited<ReturnType<typeof personWork>>;

// ------------------------------------------------------------------ suggestions

/** "Suggest a change": the client's admin, on a client that has a structure. It reaches the lead and deputy (the database tells them). */
export async function suggestChange(tx: Tx, principal: Principal, clientOrgId: string, input: { what: string; where?: string | null; why?: string | null }) {
  const client = await clientOf(tx, clientOrgId);
  assertAllowed(principal, "org_chart_request.create", resource(principal, client.id));
  const chart = await chartOf(tx, client.id);
  if (!chart) throw new NotFoundError("org_chart");
  const what = input.what.trim();
  const where = trim(input.where);
  const why = trim(input.why);
  const L = ORG_CHART_LIMITS.request;
  if (what.length < L.what.min || what.length > L.what.max) throw new BadRequestError("what");
  if ((where?.length ?? 0) > L.where || (why?.length ?? 0) > L.why) throw new BadRequestError("text_length");
  const [row] = await tx
    .insert(orgChartChangeRequests)
    .values({ chartId: chart.id, orgId: client.id, what, whereText: where, why, createdBy: principal.userId })
    .returning({ id: orgChartChangeRequests.id });
  await audit(tx, {
    actorId: principal.userId,
    orgId: principal.orgId,
    action: "org_chart_request.create",
    resourceType: "org_chart_request",
    resourceId: row!.id,
    outcome: "allow",
    meta: { client: client.id },
  });
  return { id: row!.id };
}

/** Whether the reader may read the client's suggestions (the firm's readers, the client's admins). */
export const canReadRequests = (principal: Principal, clientOrgId: string) => can(principal, "org_chart_request.read", clientOrgId);

const author = alias(user, "author");
const closer = alias(user, "closer");

/** The client's suggestions, open first: for the firm's readers and the client's admins. */
export async function listChangeRequests(tx: Tx, principal: Principal, clientOrgId: string, opts: { status?: OrgChartRequestStatus } = {}) {
  const client = await clientOf(tx, clientOrgId);
  assertAllowed(principal, "org_chart_request.read", resource(principal, client.id));
  const rows = await tx
    .select({
      id: orgChartChangeRequests.id,
      what: orgChartChangeRequests.what,
      where: orgChartChangeRequests.whereText,
      why: orgChartChangeRequests.why,
      status: orgChartChangeRequests.status,
      createdAt: orgChartChangeRequests.createdAt,
      byName: author.name,
      closedAt: orgChartChangeRequests.closedAt,
      closedByName: closer.name,
    })
    .from(orgChartChangeRequests)
    .leftJoin(author, eq(author.id, orgChartChangeRequests.createdBy))
    .leftJoin(closer, eq(closer.id, orgChartChangeRequests.closedBy))
    .where(and(eq(orgChartChangeRequests.orgId, client.id), opts.status ? eq(orgChartChangeRequests.status, opts.status) : undefined))
    .orderBy(sql`${orgChartChangeRequests.status} = 'open' desc`, desc(orgChartChangeRequests.createdAt));
  return { items: rows, canClose: can(principal, "org_chart_request.close", client.id) };
}

/** The firm marks a suggestion done (made in the draft) or declined, once. */
export async function closeChangeRequest(tx: Tx, principal: Principal, requestId: string, status: Exclude<OrgChartRequestStatus, "open">) {
  const [row] = await tx
    .select({ orgId: orgChartChangeRequests.orgId, status: orgChartChangeRequests.status })
    .from(orgChartChangeRequests)
    .where(eq(orgChartChangeRequests.id, requestId))
    .limit(1);
  if (!row) throw new NotFoundError("request");
  assertAllowed(principal, "org_chart_request.close", resource(principal, row.orgId));
  if (row.status !== "open") throw new BadRequestError("answered");
  if (status !== "done" && status !== "declined") throw new BadRequestError("status");
  await tx.update(orgChartChangeRequests).set({ status }).where(eq(orgChartChangeRequests.id, requestId));
  await audit(tx, {
    actorId: principal.userId,
    orgId: principal.orgId,
    action: "org_chart_request.close",
    resourceType: "org_chart_request",
    resourceId: requestId,
    outcome: "allow",
    meta: { client: row.orgId, status },
  });
  return { ok: true };
}

/**
 * The suggestions waiting on the client's lead or deputy, for the firm home's
 * "Waiting on your decision" (batch 2): every open one on a client the
 * reader leads, read under their rights, with who wrote it. The firm marks
 * one done or declined on the client's Structure tab.
 */
export async function openRequestsToDecide(tx: Tx, principal: Principal) {
  if (principal.orgKind !== "firm" || !principal.leadClientIds.size) return [];
  const rows = await tx
    .select({
      id: orgChartChangeRequests.id,
      orgId: orgChartChangeRequests.orgId,
      what: orgChartChangeRequests.what,
      createdAt: orgChartChangeRequests.createdAt,
      byName: author.name,
      orgName: organizations.name,
      orgNameAr: organizations.nameAr,
    })
    .from(orgChartChangeRequests)
    .innerJoin(organizations, eq(organizations.id, orgChartChangeRequests.orgId))
    .leftJoin(author, eq(author.id, orgChartChangeRequests.createdBy))
    .where(and(eq(orgChartChangeRequests.status, "open"), inArray(orgChartChangeRequests.orgId, [...principal.leadClientIds])))
    .orderBy(asc(orgChartChangeRequests.createdAt));
  return rows.filter((r) => can(principal, "org_chart_request.close", r.orgId));
}

// ------------------------------------------------------------------ the department-head suggestion

export interface HeadSuggestion {
  departmentId: string;
  departmentNameAr: string | null;
  departmentNameEn: string | null;
  unitNameAr: string | null;
  unitNameEn: string | null;
  positionTitleAr: string | null;
  positionTitleEn: string | null;
  /** Who holds the unit's head position today, with an account. */
  holder: { userId: string; name: string };
  /** Who heads the department in Selah today (nobody, or someone else). */
  heads: { userId: string; name: string }[];
}

const headRecord = (p: Principal, orgId: string): Resource => ({
  type: "department",
  orgId,
  firmOrgId: p.orgKind === "firm" ? p.orgId : undefined,
  projectId: null,
});

/**
 * Where the structure and the departments disagree about a head: the head
 * position of a unit linked to one of the client's active departments is
 * held today, on the current version, by someone with an account who is not
 * that department's head in Selah. Only a suggestion, for the people who
 * manage departments (the client's admin, the firm admin): nothing changes
 * unless one of them confirms it, and the structure itself never grants or
 * limits anyone's access. Empty with departments off, at a client that keeps
 * minimal records, or for anyone else.
 */
export async function headSuggestions(tx: Tx, principal: Principal, clientOrgId: string, today = firmToday()): Promise<HeadSuggestion[]> {
  if (!UUID.test(clientOrgId) || !authorize(principal, "department.manage", headRecord(principal, clientOrgId)).allowed || !canReadStructure(principal, clientOrgId)) return [];
  const chart = await getPublishedChart(tx, principal, clientOrgId, today);
  const { departmentsEnabled } = await clientOf(tx, clientOrgId);
  if (!chart.version || chart.client.minimalRecords || !departmentsEnabled) return [];
  const linked = chart.units.filter((u) => u.departmentId);
  if (!linked.length) return [];
  const active = await tx
    .select({ id: departments.id, nameAr: departments.nameAr, nameEn: departments.nameEn })
    .from(departments)
    .where(and(eq(departments.orgId, clientOrgId), eq(departments.active, true), inArray(departments.id, linked.map((u) => u.departmentId!))));
  const heads = active.length
    ? await tx
        .select({ departmentId: departmentMembers.departmentId, userId: departmentMembers.userId, name: user.name })
        .from(departmentMembers)
        .innerJoin(user, eq(user.id, departmentMembers.userId))
        .where(and(eq(departmentMembers.isHead, true), inArray(departmentMembers.departmentId, active.map((d) => d.id))))
    : [];
  // Only people still with the client (review S3): the leaving ends a holding today, and the account is off.
  const activePeople = new Set(
    (
      await tx
        .select({ userId: orgMemberships.userId })
        .from(orgMemberships)
        .where(and(eq(orgMemberships.orgId, clientOrgId), eq(orgMemberships.active, true)))
    ).map((m) => m.userId),
  );
  const out: HeadSuggestion[] = [];
  for (const d of active) {
    for (const u of linked.filter((x) => x.departmentId === d.id)) {
      const head = chart.positions.find((p) => p.unitId === u.id && p.isHead);
      if (!head) continue;
      // Someone whose holding ends today, or who is no longer one of the client's active people (the leaving
      // ends a holding today), is leaving the position: never suggested, and not counted (review S3).
      const staying = head.holders.filter((h) => (h.to === null || h.to > today) && (!h.userId || activePeople.has(h.userId)));
      // Only while the head position has exactly one holder (review S2): with several, which one heads the
      // department is the people's own choice, and confirming one would undo the other.
      if (staying.length !== 1) continue;
      const theirs = heads.filter((h) => h.departmentId === d.id);
      for (const h of staying) {
        if (!h.named || !h.userId || !h.name) continue;
        if (theirs.some((x) => x.userId === h.userId) || out.some((s) => s.departmentId === d.id && s.holder.userId === h.userId)) continue;
        out.push({
          departmentId: d.id,
          departmentNameAr: d.nameAr,
          departmentNameEn: d.nameEn,
          unitNameAr: u.nameAr,
          unitNameEn: u.nameEn,
          positionTitleAr: head.titleAr,
          positionTitleEn: head.titleEn,
          holder: { userId: h.userId, name: h.name },
          heads: theirs.map((x) => ({ userId: x.userId, name: x.name })),
        });
      }
    }
  }
  return out;
}

/**
 * Confirm a department-head suggestion (the client's admin or the firm
 * admin): the person holding the head position becomes the department's
 * head in Selah, through the same rule as the Departments page (added to the
 * department if they were not in it), and whoever headed it stays in it, no
 * longer as its head. Refused when the suggestion no longer stands (the
 * structure or the department changed since). Audited.
 */
export async function confirmHeadSuggestion(tx: Tx, principal: Principal, clientOrgId: string, input: { departmentId: string; userId: string }) {
  assertAllowed(principal, "department.manage", headRecord(principal, clientOrgId));
  const s = (await headSuggestions(tx, principal, clientOrgId)).find((x) => x.departmentId === input.departmentId && x.holder.userId === input.userId);
  if (!s) throw new BadRequestError("suggestion_gone");
  try {
    for (const h of s.heads) await putDepartmentMember(tx, principal, s.departmentId, h.userId, { isHead: false });
    await putDepartmentMember(tx, principal, s.departmentId, s.holder.userId, { isHead: true });
  } catch (e) {
    // The department's own rule refused it (the person left in the meantime): said in plain words, never the database's.
    if (/department members are active people/.test(`${(e as Error).message} ${((e as Error).cause as Error | undefined)?.message ?? ""}`)) {
      throw new BadRequestError("suggestion_gone");
    }
    throw e;
  }
  await audit(tx, {
    actorId: principal.userId,
    orgId: principal.orgId,
    action: "org_chart.head_confirm",
    resourceType: "department",
    resourceId: s.departmentId,
    outcome: "allow",
    meta: { client: clientOrgId, head: s.holder.userId, before: s.heads.length },
  });
  return { ok: true };
}
