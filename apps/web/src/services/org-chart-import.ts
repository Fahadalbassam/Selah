import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { createAttemptLimiter } from "@/auth/attempts";
import { authorize, CLIENT_ROLES, type Principal } from "@/authz";
import type { Tx } from "@/db/client";
import { orgChartPlannedHolders, orgMemberships, projects, user } from "@/db/schema";
import { env } from "@/env";
import type { Locale } from "@/i18n/config";
import { firmToday } from "@/lib/dates";
import { localName } from "@/lib/names";
import { readDocx } from "@/lib/office/docx-read";
import { readXlsx } from "@/lib/office/xlsx-read";
import { writeXlsx, type CellValue } from "@/lib/office/xlsx-write";
import { OfficeFileError } from "@/lib/office/zip";
import {
  checkOrgImport,
  draftRows,
  fillCodes,
  findTemplateSheet,
  ORG_CODE_FIELDS,
  ORG_IMPORT_FIELDS,
  ORG_IMPORT_LIMITS,
  outlineRows,
  sheetRows,
  structureRows,
  type Dropped,
  type OrgImportContext,
  type OrgImportMode,
  type OrgImportSource,
  type OrgRow,
  type OrgValues,
  type PlannedHolder,
  type Taken,
} from "@/lib/org-chart-import";
import { BadRequestError, ConflictError, NotFoundError, RateLimitError, UnavailableError } from "@/server/errors";
import { draftOrgChart } from "./ai-client";
import { audit } from "./audit";
import type { PreparedUpload } from "./evidence";
import { textMasker } from "./masking";
import * as OC from "./org-chart";

// Org chart, part 4: the ways a client's structure gets into the firm's
// draft (the Excel template and its export, a Word outline, the assistant's
// draft from pasted text). Two steps, and nothing is written until the
// second: a file or a text becomes rows (parseImportFile, draftFromText), a
// person checks and fixes them on the review screen, then saves
// (saveImport), which checks every row again here and writes the draft in
// one transaction through the org chart's own services (part 1), so every
// rule of the draft holds. Nothing is published: publishing is the firm's
// own step. Only the draft's editors (the firm admin, the client's lead and
// deputy, consultants staffed and not observing on one of its open
// projects) may import; for anyone else, and for another client, every call
// is a 404. Selah records the structure the firm decides and never judges one.

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Twenty drafts per person an hour (OWASP LLM10; src/auth/attempts.ts keeps the counts in memory).
const draftsPerPerson = createAttemptLimiter({ max: 20, windowSeconds: 60 * 60 });
// The filled template, like the PDF: ten per person per ten minutes.
const workbooksPerPerson = createAttemptLimiter({ max: 10, windowSeconds: 10 * 60 });

/** Whether the reader may import into the client's draft: the draft's editors (the database: app_org_chart_editor). */
export function canImport(principal: Principal, clientOrgId: string): boolean {
  return (
    principal.orgKind === "firm" &&
    authorize(principal, "org_chart.edit", { type: "org_chart", orgId: clientOrgId, firmOrgId: principal.orgId, projectId: null, draft: true }).allowed
  );
}

/**
 * Whether the AI service runs the local model, so pasted text never leaves
 * Selah's own server: the web app's copy of the service's setting
 * (LLM_PROVIDER), read straight from the environment. Only "ollama", given
 * in so many words, is local: unset or anything else counts as a hosted
 * model (fail closed; the recheck of 19 Nov found the hot-reload setup
 * leaves it unset while the service runs a hosted model). The AI service
 * checks its own setting too and refuses (409 "local model only").
 */
export function localModel(provider: string | undefined = process.env.LLM_PROVIDER): boolean {
  return provider === "ollama";
}

/**
 * The client's projects the reader may ask the assistant about, the way the
 * assistant decides it (authorize "assistant.query" on each project the
 * reader can open), and only with the local model (the coordinator's
 * decision, 18 Nov: a pasted chart is mostly names Selah does not know, and
 * those could not be masked before a hosted model). Empty means the paste
 * option is hidden and drafting from text is refused. Their names are what
 * the pasted text is masked with, as a second line.
 */
async function assistantProjects(tx: Tx, principal: Principal, clientOrgId: string): Promise<string[]> {
  if (!localModel()) return [];
  const rows = await tx
    .select({ id: projects.id, orgId: projects.orgId, firmOrgId: projects.firmOrgId })
    .from(projects)
    .where(eq(projects.orgId, clientOrgId));
  return rows
    .filter((p) => authorize(principal, "assistant.query", { type: "project", id: p.id, orgId: p.orgId, firmOrgId: p.firmOrgId, projectId: p.id }).allowed)
    .map((p) => p.id);
}

export interface Plan {
  userId: string | null;
  /** The typed name, or the person's name for an account. */
  name: string | null;
  typed: boolean;
}

/**
 * The planned holders of positions of the draft, in the order the row gave
 * them, read under the reader's row-level security: the draft's editors read
 * them, anyone else none (migration 0098).
 */
async function plansOf(tx: Tx, positionIds: string[]): Promise<Map<string, Plan[]>> {
  const out = new Map<string, Plan[]>();
  if (!positionIds.length) return out;
  const rows = await tx
    .select({ positionId: orgChartPlannedHolders.positionId, userId: orgChartPlannedHolders.userId, typed: orgChartPlannedHolders.name, name: user.name })
    .from(orgChartPlannedHolders)
    .leftJoin(user, eq(user.id, orgChartPlannedHolders.userId))
    .where(inArray(orgChartPlannedHolders.positionId, positionIds))
    .orderBy(asc(orgChartPlannedHolders.sortOrder), asc(orgChartPlannedHolders.createdAt));
  for (const r of rows) out.set(r.positionId, [...(out.get(r.positionId) ?? []), { userId: r.userId, name: r.typed ?? r.name, typed: r.typed !== null }]);
  return out;
}

/**
 * Replace who is planned for a position of the draft (the import's holder
 * column; never a holding: people are placed only on the live structure,
 * and publishing, part 5, places the planned ones). The database refuses a
 * position outside the draft, a client with minimal records, a person who is
 * not one of the client's own active people, and anyone but the draft's
 * editors. Audited without the names.
 */
async function setPlans(tx: Tx, principal: Principal, clientOrgId: string, position: { id: string; code: string }, holders: PlannedHolder[]) {
  await tx.delete(orgChartPlannedHolders).where(eq(orgChartPlannedHolders.positionId, position.id));
  if (holders.length)
    await tx.insert(orgChartPlannedHolders).values(
      holders.map((h, i) => ({
        orgId: clientOrgId,
        positionId: position.id,
        userId: "userId" in h ? h.userId : null,
        name: "name" in h ? h.name : null,
        sortOrder: i,
        createdBy: principal.userId,
      })),
    );
  await audit(tx, {
    actorId: principal.userId,
    orgId: principal.orgId,
    action: "org_chart.plan",
    resourceType: "org_chart",
    resourceId: position.id,
    outcome: "allow",
    meta: { client: clientOrgId, code: position.code, accounts: holders.filter((h) => "userId" in h).length, typed: holders.filter((h) => "name" in h).length },
  });
}

/**
 * The names planned for positions of the draft, by position id, for the
 * draft editor (part 3): read under the reader's row-level security, so only
 * the draft's editors get any; never a holder, never shown to a client.
 */
export async function plannedNames(tx: Tx, positionIds: string[]): Promise<Record<string, string[]>> {
  const plans = await plansOf(tx, positionIds);
  return Object.fromEntries([...plans].map(([id, list]) => [id, list.flatMap((h) => (h.name ? [h.name] : []))]));
}

/**
 * Remove who is planned for a position of the client's draft ("Remove plan"
 * in the draft editor): the draft's editors only, anyone else a 404. A plan
 * is the firm's working note: removing it changes nobody's holding.
 */
export async function clearPlan(tx: Tx, principal: Principal, clientOrgId: string, positionId: string) {
  const view = await importContext(tx, principal, clientOrgId);
  if (!view || !UUID.test(positionId)) throw new NotFoundError("position");
  const d = await OC.getDraft(tx, principal, clientOrgId);
  const position = d.positions.find((p) => p.id === positionId);
  if (!position) throw new NotFoundError("position");
  await setPlans(tx, principal, clientOrgId, { id: position.id, code: position.code }, []);
  return { ok: true };
}

/**
 * How many positions of the client's draft plan this person, for the leaving
 * list (leaving removes them: migration 0100). Read under the reader's
 * row-level security: only the draft's editors count any, so a client's admin
 * switching someone off learns nothing of the firm's draft.
 */
export async function plansNaming(tx: Tx, clientOrgId: string, userId: string): Promise<number> {
  const rows = await tx
    .select({ id: orgChartPlannedHolders.id })
    .from(orgChartPlannedHolders)
    .where(and(eq(orgChartPlannedHolders.orgId, clientOrgId), eq(orgChartPlannedHolders.userId, userId)));
  return rows.length;
}

/** Whether a position's plan already is this list (same people, same order). */
const samePlan = (current: Plan[], wanted: PlannedHolder[]) =>
  current.length === wanted.length &&
  current.every((c, i) => {
    const w = wanted[i]!;
    return "userId" in w ? c.userId === w.userId : c.typed && c.name === w.name;
  });

/** What an import works against, for the import page and the server's own checks. Null for anyone who may not import (the caller answers 404). */
export async function importContext(tx: Tx, principal: Principal, clientOrgId: string) {
  if (!UUID.test(clientOrgId) || !canImport(principal, clientOrgId)) return null;
  const d = await OC.getDraft(tx, principal, clientOrgId).catch((e: unknown) => (e instanceof NotFoundError ? null : Promise.reject(e)));
  if (!d?.canEditDraft) return null;
  const unitCode = new Map(d.units.map((u) => [u.id, u.code]));
  const positionCode = new Map(d.positions.map((p) => [p.id, p.code]));
  const people = d.client.minimalRecords
    ? []
    : await tx
        .select({ userId: user.id, email: user.email, name: user.name })
        .from(orgMemberships)
        .innerJoin(user, eq(user.id, orgMemberships.userId))
        .where(and(eq(orgMemberships.orgId, clientOrgId), eq(orgMemberships.active, true), inArray(orgMemberships.role, [...CLIENT_ROLES])));
  const plans = await plansOf(tx, d.positions.map((p) => p.id));
  const ctx: OrgImportContext = {
    minimalRecords: d.client.minimalRecords,
    people,
    draft: {
      units: d.units.map((u) => ({
        code: u.code,
        parentCode: u.parentId ? (unitCode.get(u.parentId) ?? null) : null,
        level: u.level,
        nameAr: u.nameAr,
        nameEn: u.nameEn,
        kind: u.kind,
        advisory: u.advisory,
      })),
      positions: d.positions.map((p) => ({
        code: p.code,
        unitCode: unitCode.get(p.unitId) ?? "",
        reportsTo: p.reportsToId ? (positionCode.get(p.reportsToId) ?? null) : null,
        isHead: p.isHead,
        titleAr: p.titleAr,
        titleEn: p.titleEn,
        holders: p.holders.map((h) => ({ userId: h.userId, name: h.name })),
        planned: (plans.get(p.id) ?? []).map((h) => ({ userId: h.userId, name: h.name })),
      })),
    },
  };
  return {
    client: d.client,
    today: d.today,
    ctx,
    /** The draft already holds something: saving asks whether to replace it or add to it. */
    draftHasContent: d.units.length + d.positions.length > 0,
    /** The assistant is on for this reader at this client: the paste option shows. */
    assistant: (await assistantProjects(tx, principal, clientOrgId)).length > 0,
  };
}

export type OrgImportView = NonNullable<Awaited<ReturnType<typeof importContext>>>;

const takenOf = (ctx: OrgImportContext): Taken => ({
  units: new Set(ctx.draft.units.map((u) => u.code)),
  positions: new Set(ctx.draft.positions.map((p) => p.code)),
});

/** A signed note of what the rows came from, so the save's audit record names the file (or text) that was read, not one the browser claims. */
function signSource(s: { clientOrgId: string; userId: string; sha256: string; source: OrgImportSource }): string {
  const payload = Buffer.from(JSON.stringify({ ...s, at: Date.now() })).toString("base64url");
  const mac = createHmac("sha256", env().BETTER_AUTH_SECRET).update(`org-chart-import:${payload}`).digest("base64url");
  return `${payload}.${mac}`;
}

function verifySource(token: string, clientOrgId: string, userId: string): { sha256: string; source: OrgImportSource } {
  const expired = () => new BadRequestError("the import has expired: bring the rows in again");
  const [payload, mac] = token.split(".");
  if (!payload || !mac) throw expired();
  const expected = createHmac("sha256", env().BETTER_AUTH_SECRET).update(`org-chart-import:${payload}`).digest();
  const given = Buffer.from(mac, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw expired();
  const data = JSON.parse(Buffer.from(payload, "base64url").toString()) as { clientOrgId: string; userId: string; sha256: string; source: OrgImportSource; at: number };
  // A check is worked through in one sitting; a day is plenty.
  if (data.clientOrgId !== clientOrgId || data.userId !== userId || Date.now() - data.at > 24 * 3600_000) throw expired();
  return { sha256: data.sha256, source: data.source };
}

export interface ImportedRows {
  token: string;
  /** The file's name; null for pasted text. */
  fileName: string | null;
  source: OrgImportSource;
  rows: OrgRow[];
  /** Only from the assistant: what it returned that is not in the text, left out. */
  dropped: Dropped[];
}

/**
 * Read an uploaded (checked and scanned) file into rows: the template's sheet
 * from an Excel workbook, or a Word document's outline. Codes are given
 * where the file has none. Nothing is stored.
 */
export async function parseImportFile(tx: Tx, principal: Principal, clientOrgId: string, file: PreparedUpload): Promise<ImportedRows> {
  const view = await importContext(tx, principal, clientOrgId);
  if (!view) throw new NotFoundError("org chart");
  if (file.contentType !== XLSX && file.contentType !== DOCX) throw new BadRequestError("file rejected: type");
  const source: OrgImportSource = file.contentType === XLSX ? "xlsx" : "docx";
  let rows: OrgRow[];
  try {
    if (source === "xlsx") {
      const found = findTemplateSheet(readXlsx(file.bytes));
      if (!found) throw new BadRequestError("not the template");
      rows = fillCodes(sheetRows(found.sheet.rows, found.headerRow, found.mapping, found.sheet.numeric), takenOf(view.ctx));
    } else {
      const blocks = readDocx(file.bytes);
      if (!blocks.some((b) => b.type === "heading")) throw new BadRequestError("no headings");
      rows = outlineRows(blocks, takenOf(view.ctx));
    }
  } catch (err) {
    if (err instanceof OfficeFileError) throw new BadRequestError(`file rejected: ${err.reason === "not_office" ? "type" : err.reason}`);
    throw err;
  }
  if (!rows.length) throw new BadRequestError("nothing to import");
  await audit(tx, {
    actorId: principal.userId,
    orgId: principal.orgId,
    action: "org_chart.import_read",
    resourceType: "organization",
    resourceId: clientOrgId,
    outcome: "allow",
    meta: { source, sha256: file.sha256, sizeBytes: file.bytes.byteLength, scanned: file.scanned, rows: rows.length },
  });
  return { token: signSource({ clientOrgId, userId: principal.userId, sha256: file.sha256, source }), fileName: file.fileName, source, rows, dropped: [] };
}

/**
 * "Paste a list or description and let the assistant draft it", with the
 * local model only. The draft never handles people: the schema has no field
 * for one and the prompt asks for units and positions only, so the screen
 * asks for titles only (names are added later). As a second line the text is
 * still masked (textMasker, the same masking as the assistant's: every name
 * of the client's projects written in the text) and placeholders are put
 * back only where the text had them. Only units, positions and specialties
 * written in the text are kept (draftRows); anything else the model returns
 * is left out and listed, never added. The rows go to the same review step
 * as a file. Only where the assistant is on for this reader at this client.
 */
export async function draftFromText(tx: Tx, principal: Principal, clientOrgId: string, text: string, maskOn?: boolean): Promise<ImportedRows> {
  const view = await importContext(tx, principal, clientOrgId);
  if (!view) throw new NotFoundError("org chart");
  const projectIds = await assistantProjects(tx, principal, clientOrgId);
  if (!projectIds.length) throw new NotFoundError("assistant");
  const body = text.replace(/\r\n?/g, "\n").trim();
  if (!body) throw new BadRequestError("no text");
  // "text too long: N": by how many characters it must be shorter.
  if (body.length > ORG_IMPORT_LIMITS.text) throw new BadRequestError(`text too long: ${body.length - ORG_IMPORT_LIMITS.text}`);
  const masker = await textMasker(tx, projectIds, body, maskOn);
  const masked = masker.mask(body);
  // The AI service takes as much after masking, and a placeholder can be longer than the name it hides ("جدة" is "[PLACE_1]").
  if (masked.length > ORG_IMPORT_LIMITS.text) throw new BadRequestError(`text too long: ${masked.length - ORG_IMPORT_LIMITS.text}`);
  if (draftsPerPerson.take(principal.userId) !== null) throw new RateLimitError("too many drafts");

  let reply: Awaited<ReturnType<typeof draftOrgChart>>;
  try {
    reply = await draftOrgChart(masked);
  } catch (e) {
    // The service runs a hosted model whatever this app believes: it refuses, and the screen says the assistant cannot draft here.
    if (e instanceof Error && /failed: 409$/.test(e.message)) throw new ConflictError("local model only");
    throw new UnavailableError("the assistant could not draft rows");
  }
  // A placeholder comes back only where the text had it: one the text never had stays a placeholder, and draftRows drops it.
  const back = (s: string) => masker.unmask(s);
  const { rows, dropped } = draftRows(
    {
      units: reply.units.map((u) => ({ ref: u.ref, parent: u.parent, kind: u.kind, name: back(u.name), code: back(u.code) })),
      positions: reply.positions.map((p) => ({
        ref: p.ref,
        unit: p.unit,
        reports_to: p.reports_to,
        head: p.head,
        title: back(p.title),
        code: back(p.code),
        specialties: p.specialties.map(back),
      })),
    },
    body,
    takenOf(view.ctx),
  );
  const sha256 = createHash("sha256").update(body).digest("hex");
  await audit(tx, {
    actorId: principal.userId,
    orgId: principal.orgId,
    action: "org_chart.import_draft",
    resourceType: "organization",
    resourceId: clientOrgId,
    outcome: "allow",
    // Never the text itself: its length, its hash, and what came of it.
    meta: { chars: body.length, sha256, masked: masker.replaced, rows: rows.length, dropped: dropped.length, model: reply.model },
  });
  return { token: signSource({ clientOrgId, userId: principal.userId, sha256, source: "text" }), fileName: null, source: "text", rows, dropped };
}

export interface SaveInput {
  token: string;
  rows: { line: number; values: OrgValues }[];
  /** Asked only when the draft already holds something. */
  mode?: OrgImportMode;
}

/**
 * Write the reviewed rows into the client's draft, all or nothing, through
 * the org chart's services: the chart and its draft are started when there
 * are none; replacing, a unit or position with the same code is updated in
 * place (who holds it today does not change, and holdings follow it), the
 * rest of the draft is removed; adding, the draft stays and the rows are
 * added. The holder column is a plan (org_chart_planned_holders): nobody is
 * placed by an import, publishing places the planned people (part 5). The
 * rows are checked again here against the draft as it is now; any row with
 * an error refuses the whole save. Nothing is published.
 */
export async function saveImport(tx: Tx, principal: Principal, clientOrgId: string, input: SaveInput) {
  const view = await importContext(tx, principal, clientOrgId);
  if (!view) throw new NotFoundError("org chart");
  const from = verifySource(input.token, clientOrgId, principal.userId);
  const rows: OrgRow[] = input.rows.map((r) => ({ line: r.line, values: r.values, include: true, filled: [] }));
  if (new Set(rows.map((r) => r.line)).size !== rows.length) throw new BadRequestError("invalid input");
  if (view.draftHasContent && !input.mode) throw new BadRequestError("replace or add");
  const mode: OrgImportMode = view.draftHasContent ? input.mode! : "add";
  const check = checkOrgImport(rows, view.ctx, mode);
  if (check.tooMany) throw new BadRequestError("too many rows");
  if (check.counts.withErrors) throw new BadRequestError(`rows with errors: ${check.rows.filter((r) => r.errors.length).map((r) => r.line).join(",")}`);
  const { plan } = check;
  if (!plan.units.length && !plan.positions.length) throw new BadRequestError("nothing to import");

  await OC.startChart(tx, principal, clientOrgId);
  const d = await OC.getDraft(tx, principal, clientOrgId);
  if (!d.draft) throw new NotFoundError("draft");
  const unitByCode = new Map(d.units.map((u) => [u.code, u]));
  const unitId = new Map(d.units.map((u) => [u.code, u.id]));
  const positionByCode = new Map(d.positions.map((p) => [p.code, p]));
  const positionId = new Map(d.positions.map((p) => [p.code, p.id]));
  const plans = await plansOf(tx, d.positions.map((p) => p.id));
  const counts = { unitsAdded: 0, unitsChanged: 0, unitsRemoved: 0, positionsAdded: 0, positionsChanged: 0, positionsRemoved: 0, planned: 0 };

  // 1. Units, parents first: a unit of the draft is moved and changed in place, a new one added.
  let anyMoved = false;
  for (const u of plan.units) {
    const parentId = u.parentCode ? unitId.get(u.parentCode)! : null;
    const cur = u.inDraft ? unitByCode.get(u.code) : undefined;
    if (!cur) {
      const added = await OC.addUnit(tx, principal, clientOrgId, { kind: u.kind, nameAr: u.nameAr, nameEn: u.nameEn, code: u.code, level: u.level, advisory: u.advisory, parentId });
      unitId.set(u.code, added.id);
      counts.unitsAdded++;
      continue;
    }
    const moved = cur.parentId !== parentId;
    if (moved) await OC.moveUnit(tx, principal, cur.id, { parentId });
    anyMoved ||= moved;
    const set: Partial<OC.UnitInput> = {};
    if (cur.kind !== u.kind) set.kind = u.kind;
    if (cur.nameAr !== u.nameAr || cur.nameEn !== u.nameEn) Object.assign(set, { nameAr: u.nameAr, nameEn: u.nameEn });
    // A move may shift the levels of the units under it too; the rows say where each sits.
    if (anyMoved || cur.level !== u.level) set.level = u.level;
    if (cur.advisory !== u.advisory) set.advisory = u.advisory;
    if (Object.keys(set).length) await OC.updateUnit(tx, principal, cur.id, set);
    if (moved || Object.keys(set).length) counts.unitsChanged++;
  }

  // 2. Positions: a position of the draft is moved and changed in place (its people stay), a new one added.
  for (const p of plan.positions) {
    const unit = unitId.get(p.unitCode)!;
    const cur = p.inDraft ? positionByCode.get(p.code) : undefined;
    if (!cur) {
      const added = await OC.addPosition(tx, principal, unit, {
        code: p.code,
        titleAr: p.titleAr,
        titleEn: p.titleEn,
        specialties: p.specialties,
        plannedCount: p.plannedCount,
        isHead: p.isHead,
      });
      positionId.set(p.code, added.id);
      counts.positionsAdded++;
      continue;
    }
    const moved = cur.unitId !== unit;
    // Moving to another unit ends heading the old one.
    if (moved) await OC.movePosition(tx, principal, cur.id, { unitId: unit });
    const set: OC.PositionInput = {};
    if (cur.titleAr !== p.titleAr || cur.titleEn !== p.titleEn) Object.assign(set, { titleAr: p.titleAr, titleEn: p.titleEn });
    if (cur.specialties.join("\u0000") !== p.specialties.join("\u0000")) set.specialties = p.specialties;
    if (cur.plannedCount !== p.plannedCount) set.plannedCount = p.plannedCount;
    if ((moved ? false : cur.isHead) !== p.isHead) set.isHead = p.isHead;
    if (Object.keys(set).length) await OC.updatePosition(tx, principal, cur.id, set);
    if (moved || Object.keys(set).length) counts.positionsChanged++;
  }

  // 3. Replacing: the draft's positions the rows do not hold go (whoever reported to them reports to no one until the lines below).
  for (const code of plan.removePositions) {
    await OC.deletePosition(tx, principal, positionByCode.get(code)!.id);
    counts.positionsRemoved++;
  }

  // 4. Reporting lines. Lines that change are cleared first, so no step on the way closes a loop.
  const want = new Map(plan.positions.map((p) => [p.code, p.reportsTo ? positionId.get(p.reportsTo)! : null]));
  for (const p of plan.positions) {
    const cur = p.inDraft ? positionByCode.get(p.code) : undefined;
    if (cur?.reportsToId && cur.reportsToId !== want.get(p.code)) await OC.setReportsTo(tx, principal, cur.id, null);
  }
  for (const p of plan.positions) {
    const cur = p.inDraft ? positionByCode.get(p.code) : undefined;
    const target = want.get(p.code);
    if (target && cur?.reportsToId !== target) await OC.setReportsTo(tx, principal, positionId.get(p.code)!, target);
  }

  // 5. People are planned, never placed: the row's holder column becomes the position's plan (a
  //    position kept by its code has its plan replaced; who holds it today does not change).
  //    Never at a minimal-records client: the check gave none, and the database refuses one.
  for (const p of plan.positions) {
    const current = p.inDraft ? (plans.get(positionByCode.get(p.code)!.id) ?? []) : [];
    if (samePlan(current, p.holders)) continue;
    await setPlans(tx, principal, clientOrgId, { id: positionId.get(p.code)!, code: p.code }, p.holders);
    counts.planned += p.holders.length;
  }

  // 6. Replacing: the draft's units the rows do not hold go, the deepest first (they are empty by now).
  if (plan.removeUnits.length) {
    const parentOf = new Map(d.units.map((u) => [u.id, u.parentId]));
    const depth = (id: string) => {
      let n = 0;
      for (let at = parentOf.get(id); at && n < 100; at = parentOf.get(at)) n++;
      return n;
    };
    const gone = plan.removeUnits.map((c) => unitByCode.get(c)!).sort((a, b) => depth(b.id) - depth(a.id));
    for (const u of gone) {
      await OC.deleteUnit(tx, principal, u.id);
      counts.unitsRemoved++;
    }
  }

  // 7. Replacing: units in the rows' order among their siblings.
  if (mode === "replace") {
    const after = await OC.getDraft(tx, principal, clientOrgId);
    const byParent = new Map<string | null, string[]>();
    for (const u of plan.units) byParent.set(u.parentCode, [...(byParent.get(u.parentCode) ?? []), u.code]);
    for (const [parentCode, codes] of byParent) {
      const parentId = parentCode ? unitId.get(parentCode)! : null;
      const now = after.units
        .filter((u) => u.parentId === parentId)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((u) => u.code);
      if (now.join("\u0000") === codes.join("\u0000")) continue;
      for (const [i, code] of codes.entries()) await OC.moveUnit(tx, principal, unitId.get(code)!, { parentId, index: i });
    }
  }

  await audit(tx, {
    actorId: principal.userId,
    orgId: principal.orgId,
    action: "org_chart.import",
    resourceType: "org_chart",
    resourceId: d.draft.id,
    outcome: "allow",
    // The rows are the reviewed ones (people fix rows before saving), read from the file or text with this hash.
    meta: { client: clientOrgId, source: from.source, sha256: from.sha256, mode, rows: rows.length, ...counts },
  });
  return { draftId: d.draft.id, mode, counts };
}

// ------------------------------------------------------------------ the template and the export

const XLSX_TYPE = XLSX;

function fileName(base: string, ext: string): string {
  return `${base}-${firmToday()}.${ext}`;
}

/** The template's sheets: the structure (headings in the reader's language, then the other, one per line) and the guide. */
async function templateSheets(locale: Locale, rows: CellValue[][]) {
  const other: Locale = locale === "ar" ? "en" : "ar";
  const t = await getTranslations({ locale, namespace: "orgChartImport" });
  const o = await getTranslations({ locale: other, namespace: "orgChartImport" });
  const header = (f: (typeof ORG_IMPORT_FIELDS)[number]) => `${t(`fields.${f}`)}\n${o(`fields.${f}`)}`;
  const WIDTH: Partial<Record<(typeof ORG_IMPORT_FIELDS)[number], number>> = {
    unitNameAr: 30,
    unitNameEn: 30,
    titleAr: 32,
    titleEn: 32,
    holder: 28,
    specialties: 32,
    advisory: 16,
    reportsTo: 18,
  };
  const rtl = locale === "ar";
  return [
    { name: t("guide.structureSheet"), rtl, columns: ORG_IMPORT_FIELDS.map((f) => ({ header: header(f), width: WIDTH[f] ?? 14, text: ORG_CODE_FIELDS.includes(f) })), rows },
    {
      name: t("guide.sheet"),
      rtl,
      columns: [
        { header: t("guide.column"), width: 34 },
        { header: t("guide.what"), width: 90 },
        { header: t("guide.example"), width: 26 },
      ],
      rows: [
        ...(["one", "unitOnly", "codes", "review"] as const).map((k) => ["", t(`guide.rules.${k}`), ""]),
        ["", "", ""],
        ...ORG_IMPORT_FIELDS.map((f) => [header(f), t(`guide.fields.${f}`), t(`guide.examples.${f}`)]),
      ],
    },
  ];
}

/** The empty template to fill in, for the people who may import into this client's draft. */
export async function orgChartTemplate(locale: Locale) {
  return { bytes: writeXlsx(await templateSheets(locale, [])), fileName: fileName("selah-structure-template", "xlsx"), contentType: XLSX_TYPE };
}

/**
 * A version of the client's structure in the same template, so it can be
 * changed in Excel and brought back in: "draft", a version's id, or nothing
 * for the current version. For the draft's editors only (the coordinator's
 * decision, 18 Nov 2026: it holds e-mails, planned numbers, specialties and,
 * for the draft, plans, none of which the Structure tab shows; anyone else,
 * a 404), and limited like the PDF. It reads through getStructure, so the
 * names are the ones the database sends. A person with an account is
 * written as their e-mail, so the file comes back as the same person; a
 * typed name as typed.
 */
export async function orgChartWorkbook(tx: Tx, principal: Principal, clientOrgId: string, pick: string | undefined, locale: Locale) {
  if (!(await importContext(tx, principal, clientOrgId))) throw new NotFoundError("org chart");
  if (workbooksPerPerson.take(principal.userId) !== null) throw new RateLimitError("too many workbook exports");
  const view = await OC.getStructure(tx, principal, clientOrgId, pick ?? null);
  const shown = view.shown;
  if (!shown) throw new NotFoundError("org chart");
  const names = shown.names !== "none";
  const draft = shown.version.state === "draft";
  // The draft's holder column is its plan, so the file comes back as the same plan: who is
  // planned for each position (read as the reader: the draft's editors only), and vacant
  // only where nobody is planned and nobody holds it today. A published version: its holders.
  const plans = draft ? await plansOf(tx, shown.positions.map((p) => p.id)) : new Map<string, Plan[]>();
  const positions = draft
    ? shown.positions.map((p) => {
        const planned = plans.get(p.id) ?? [];
        return {
          ...p,
          holders: planned.map((h) => ({ userId: h.userId, name: h.name, named: true })),
          vacant: p.vacant === null ? null : planned.length === 0 && p.holders.length === 0,
        };
      })
    : shown.positions;
  const ids = [...new Set(positions.flatMap((p) => p.holders.flatMap((h) => (h.named && h.userId ? [h.userId] : []))))];
  const emails = new Map(
    ids.length ? (await tx.select({ id: user.id, email: user.email }).from(user).where(inArray(user.id, ids))).map((u) => [u.id, u.email]) : [],
  );
  const rows = structureRows(shown.units, positions, {
    locale,
    names,
    holderText: (h) => (h.userId ? (emails.get(h.userId) ?? h.name) : h.name),
  });
  const bytes = writeXlsx(await templateSheets(locale, rows));
  await audit(tx, {
    actorId: principal.userId,
    orgId: principal.orgId,
    action: "org_chart.workbook",
    resourceType: "org_chart",
    resourceId: shown.version.id,
    outcome: "allow",
    meta: { client: view.client.id, format: "xlsx", number: shown.version.number, names },
  });
  const t = await getTranslations({ locale, namespace: "orgChart" });
  return {
    bytes,
    fileName: fileName(`selah-structure-${draft ? "draft" : `v${shown.version.number}`}`, "xlsx"),
    contentType: XLSX_TYPE,
    title: [t("pdf.title"), localName(view.client, locale === "ar"), draft ? t("version.draft") : t("version.number", { n: shown.version.number ?? 0 })].join(" - "),
  };
}
