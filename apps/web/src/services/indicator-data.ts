import "server-only";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { clientIndicatorSettings, clientKpis, indicatorFeeds, indicatorImports, organizations, user } from "@/db/schema";
import { assertAllowed, authorize, type Principal, type Resource } from "@/authz";
import { env } from "@/env";
import { firmToday } from "@/lib/dates";
import {
  MAX_IMPORT_VALUES,
  MAX_SHEET_BYTES,
  detectShape,
  matchLabels,
  parseNumber,
  parsePeriod,
  planCounts,
  planValues,
  readCsv,
  readValues,
  sheetCsvUrl,
  sheetHostAllowed,
  type IndicatorRef,
  type PlannedValue,
} from "@/lib/indicator-import";
import { readXlsx } from "@/lib/office/xlsx-read";
import { OfficeFileError } from "@/lib/office/zip";
import { BadRequestError, NotFoundError } from "@/server/errors";
import { audit } from "./audit";
import type { PreparedUpload } from "./evidence";

// How a client's indicator figures reach Selah (migration: indicator data).
// The client chooses how much it shares: nothing (figures are typed), files
// (exports a person reviews before they count), or a connection (a sheet
// read daily, or its own systems sending figures with a key). Every batch is
// recorded and every value says how it arrived. The database holds the
// rules; these calls check first so the screens offer only what it takes.

export type DataMode = "typed" | "files" | "connected";

const resource = (p: Principal, orgId: string): Resource => ({
  type: "indicator",
  orgId,
  firmOrgId: p.orgKind === "firm" ? p.orgId : undefined,
  projectId: null,
  departmentId: null,
});

const hashOf = (token: string) => createHash("sha256").update(token).digest("hex");

/** Hosts besides Google Sheets a firm lets connections read (INDICATOR_SHEET_HOSTS, comma-separated). */
export const extraSheetHosts = () =>
  (process.env.INDICATOR_SHEET_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);

async function clientOf(tx: Tx, clientOrgId: string) {
  const [org] = await tx
    .select({ id: organizations.id, name: organizations.name, nameAr: organizations.nameAr, kind: organizations.kind, status: organizations.status })
    .from(organizations)
    .where(eq(organizations.id, clientOrgId))
    .limit(1);
  if (!org || org.kind !== "client") throw new NotFoundError("client");
  return org;
}

async function flag(tx: Tx, fn: string, orgId: string) {
  const { rows } = await tx.execute<{ ok: boolean }>(sql`select ${sql.raw(fn)}(${orgId}::uuid) as ok`);
  return rows[0]?.ok === true;
}

/** The client's indicators as the import matches them (under the reader's row-level security). */
export async function indicatorRefs(tx: Tx, clientOrgId: string): Promise<(IndicatorRef & { unit: string })[]> {
  const rows = await tx
    .select({
      id: clientKpis.id,
      nameAr: clientKpis.nameAr,
      nameEn: clientKpis.nameEn,
      code: clientKpis.code,
      frequency: clientKpis.frequency,
      baselinePeriod: clientKpis.baselinePeriod,
      active: clientKpis.active,
      feedOn: clientKpis.feedOn,
      unit: clientKpis.unit,
    })
    .from(clientKpis)
    .where(eq(clientKpis.orgId, clientOrgId))
    .orderBy(clientKpis.createdAt);
  return rows.map((r) => ({ ...r, frequency: r.frequency as IndicatorRef["frequency"] }));
}

/** Each indicator's current value per period ("kpiId|period"), for comparing a batch against. */
async function currentValues(tx: Tx, clientOrgId: string) {
  const { rows } = await tx.execute<{ id: string; kpi_id: string; period: string; value: string }>(sql`
    select v.id, v.kpi_id, v.period::text as period, v.value::text as value from client_kpi_values v
    where v.org_id = ${clientOrgId}::uuid and not exists (select 1 from client_kpi_values c where c.supersedes_id = v.id)`);
  return new Map(rows.map((r) => [`${r.kpi_id}|${r.period}`, { id: r.id, value: Number(r.value) }]));
}

/** What the data page shows: the choice, the firm's suggestion, connections, recent batches. */
export async function dataSettings(tx: Tx, principal: Principal, clientOrgId: string) {
  const client = await clientOf(tx, clientOrgId);
  assertAllowed(principal, "indicator.read", resource(principal, clientOrgId));
  const decider = sql`(select name from "user" u where u.id = ${clientIndicatorSettings.decidedBy})`;
  const proposer = sql`(select name from "user" u where u.id = ${clientIndicatorSettings.proposedBy})`;
  const [setting] = await tx
    .select({
      mode: clientIndicatorSettings.dataMode,
      decidedAt: clientIndicatorSettings.decidedAt,
      decidedBy: sql<string | null>`${decider}`,
      proposedMode: clientIndicatorSettings.proposedMode,
      proposedAt: clientIndicatorSettings.proposedAt,
      proposedBy: sql<string | null>`${proposer}`,
    })
    .from(clientIndicatorSettings)
    .where(eq(clientIndicatorSettings.orgId, clientOrgId));
  const canChoose = client.status === "active" && (await flag(tx, "app_kpi_data_admin", clientOrgId));
  const canSeeFeeds = authorize(principal, "indicator.manage", resource(principal, clientOrgId)).allowed;
  const feeds = canSeeFeeds
    ? await tx
        .select({
          id: indicatorFeeds.id,
          kind: indicatorFeeds.kind,
          label: indicatorFeeds.label,
          url: indicatorFeeds.url,
          tokenHint: indicatorFeeds.tokenHint,
          runAs: user.name,
          createdAt: indicatorFeeds.createdAt,
          lastRunAt: indicatorFeeds.lastRunAt,
          lastOkAt: indicatorFeeds.lastOkAt,
          lastError: indicatorFeeds.lastError,
          lastAdded: indicatorFeeds.lastAdded,
          failures: indicatorFeeds.failures,
        })
        .from(indicatorFeeds)
        .innerJoin(user, eq(user.id, indicatorFeeds.runAs))
        .where(and(eq(indicatorFeeds.orgId, clientOrgId), isNull(indicatorFeeds.revokedAt)))
        .orderBy(indicatorFeeds.createdAt)
    : [];
  const imports = await tx
    .select({
      id: indicatorImports.id,
      channel: indicatorImports.channel,
      fileName: indicatorImports.fileName,
      feedLabel: indicatorFeeds.label,
      by: user.name,
      onBehalf: indicatorImports.onBehalf,
      added: indicatorImports.added,
      corrected: indicatorImports.corrected,
      unchanged: indicatorImports.unchanged,
      createdAt: indicatorImports.createdAt,
    })
    .from(indicatorImports)
    .innerJoin(user, eq(user.id, indicatorImports.byUser))
    .leftJoin(indicatorFeeds, eq(indicatorFeeds.id, indicatorImports.feedId))
    .where(eq(indicatorImports.orgId, clientOrgId))
    .orderBy(desc(indicatorImports.createdAt))
    .limit(20);
  const mode = (setting?.decidedAt ? setting.mode : "typed") as DataMode;
  const canReport = client.status === "active" && authorize(principal, "indicator.report", resource(principal, clientOrgId)).allowed;
  return {
    client: { id: client.id, name: client.name, nameAr: client.nameAr },
    mode,
    chosen: !!setting?.decidedAt,
    decidedAt: setting?.decidedAt ?? null,
    decidedBy: setting?.decidedBy ?? null,
    proposal: setting?.proposedMode ? { mode: setting.proposedMode as DataMode, at: setting.proposedAt!, by: setting.proposedBy } : null,
    canChoose,
    canPropose: principal.orgKind === "firm" && client.status === "active" && canSeeFeeds,
    canImport: canReport && mode !== "typed",
    canConnect: canChoose && mode === "connected",
    feeds,
    imports,
    indicators: canSeeFeeds ? await indicatorRefs(tx, clientOrgId) : [],
    canManage: canSeeFeeds && client.status === "active",
    extraHosts: extraSheetHosts(),
  };
}

export type DataSettings = Awaited<ReturnType<typeof dataSettings>>;

/** The client's admin (or the firm, for a client with no accounts) chooses how much it shares. */
export async function chooseDataMode(tx: Tx, principal: Principal, clientOrgId: string, mode: DataMode) {
  await clientOf(tx, clientOrgId);
  assertAllowed(principal, "indicator.data", resource(principal, clientOrgId));
  if (!(await flag(tx, "app_kpi_data_admin", clientOrgId))) throw new NotFoundError("client");
  await tx
    .insert(clientIndicatorSettings)
    .values({ orgId: clientOrgId, dataMode: mode })
    .onConflictDoUpdate({ target: clientIndicatorSettings.orgId, set: { dataMode: mode } });
  await audit(tx, {
    actorId: principal.userId,
    orgId: principal.orgId,
    action: "indicator.data_mode",
    resourceType: "organization",
    resourceId: clientOrgId,
    outcome: "allow",
    meta: { mode },
  });
  return { ok: true };
}

/** The firm suggests a mode after discovery; the client's admin confirms it. */
export async function proposeDataMode(tx: Tx, principal: Principal, clientOrgId: string, mode: DataMode) {
  await clientOf(tx, clientOrgId);
  assertAllowed(principal, "indicator.manage", resource(principal, clientOrgId));
  if (principal.orgKind !== "firm") throw new NotFoundError("client");
  await tx.execute(sql`select app_propose_kpi_data_mode(${clientOrgId}::uuid, ${mode}::indicator_data_mode)`);
  await audit(tx, {
    actorId: principal.userId,
    orgId: principal.orgId,
    action: "indicator.data_propose",
    resourceType: "organization",
    resourceId: clientOrgId,
    outcome: "allow",
    meta: { mode },
  });
  return { ok: true };
}

/** An indicator's code for files and systems, and whether connections may fill it. */
export async function setIndicatorSource(tx: Tx, principal: Principal, kpiId: string, input: { code?: string | null; feedOn?: boolean }) {
  const [k] = await tx.select({ orgId: clientKpis.orgId, departmentId: clientKpis.departmentId }).from(clientKpis).where(eq(clientKpis.id, kpiId));
  if (!k) throw new NotFoundError("indicator");
  assertAllowed(principal, "indicator.manage", { ...resource(principal, k.orgId), departmentId: k.departmentId });
  const set: { code?: string | null; feedOn?: boolean } = {};
  if (input.code !== undefined) {
    const code = input.code?.trim().toLowerCase() || null;
    if (code && !/^[a-z0-9][a-z0-9_.-]{0,39}$/.test(code)) throw new BadRequestError("invalid code");
    set.code = code;
  }
  if (input.feedOn !== undefined) set.feedOn = input.feedOn;
  if (!Object.keys(set).length) return { ok: true };
  if (set.code) {
    const [taken] = await tx
      .select({ id: clientKpis.id })
      .from(clientKpis)
      .where(and(eq(clientKpis.orgId, k.orgId), eq(clientKpis.code, set.code), sql`${clientKpis.id} <> ${kpiId}::uuid`))
      .limit(1);
    if (taken) throw new BadRequestError("code taken");
  }
  await tx.update(clientKpis).set(set).where(eq(clientKpis.id, kpiId));
  await audit(tx, {
    actorId: principal.userId,
    orgId: principal.orgId,
    action: "indicator.source",
    resourceType: "indicator",
    resourceId: kpiId,
    outcome: "allow",
    meta: { fields: Object.keys(set).join(","), feedOn: set.feedOn ?? null },
  });
  return { ok: true };
}

// ------------------------------------------------------------ saving a batch

/**
 * Save a checked batch in one go: the batch's record with its counts, then
 * each new value and each correction under the person's own row-level
 * security (the database checks every one again). Nothing when nothing changes.
 */
export async function saveBatch(
  tx: Tx,
  principal: Principal,
  clientOrgId: string,
  plan: PlannedValue[],
  batch: { channel: "file" | "sheet" | "api"; feedId?: string; fileName?: string; sha256?: string },
) {
  const counts = planCounts(plan);
  const writes = plan.filter((p) => p.status === "add" || p.status === "correct");
  if (!writes.length) return { importId: null, ...counts };
  const [row] = await tx
    .insert(indicatorImports)
    .values({
      orgId: clientOrgId,
      channel: batch.channel,
      feedId: batch.feedId ?? null,
      fileName: batch.fileName?.slice(0, 200) ?? null,
      sha256: batch.sha256 ?? null,
      byUser: principal.userId,
      added: counts.add,
      corrected: counts.correct,
      unchanged: counts.same,
    })
    .returning({ id: indicatorImports.id });
  const importId = row!.id;
  // One statement for the batch: the triggers still check each row.
  const values = writes.map(
    (p) => sql`(${p.kpiId}::uuid, ${clientOrgId}::uuid, ${p.period}::date, ${String(p.value)}::numeric, ${p.note?.slice(0, 1000) ?? null}, ${principal.userId}::uuid, ${p.current?.id ?? null}::uuid, ${importId}::uuid, ${batch.channel}::indicator_channel)`,
  );
  await tx.execute(sql`
    insert into client_kpi_values (kpi_id, org_id, period, value, note, entered_by, supersedes_id, import_id, channel)
    values ${sql.join(values, sql`, `)}`);
  await audit(tx, {
    actorId: principal.userId,
    orgId: principal.orgId,
    action: "indicator.import",
    resourceType: "organization",
    resourceId: clientOrgId,
    outcome: "allow",
    meta: { batch: importId, channel: batch.channel, feed: batch.feedId ?? null, sha256: batch.sha256 ?? null, added: counts.add, corrected: counts.correct },
  });
  return { importId, ...counts };
}

// ------------------------------------------------------------ files

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function signFile(file: { orgId: string; userId: string; sha256: string; fileName: string }): string {
  const payload = Buffer.from(JSON.stringify({ ...file, at: Date.now() })).toString("base64url");
  const mac = createHmac("sha256", env().BETTER_AUTH_SECRET).update(`indicator-import:${payload}`).digest("base64url");
  return `${payload}.${mac}`;
}

function verifyFile(token: string, orgId: string, userId: string): { sha256: string; fileName: string } {
  const [payload, mac] = token.split(".");
  const expired = new BadRequestError("the import has expired: upload the file again");
  if (!payload || !mac) throw expired;
  const expected = createHmac("sha256", env().BETTER_AUTH_SECRET).update(`indicator-import:${payload}`).digest();
  const given = Buffer.from(mac, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw expired;
  const data = JSON.parse(Buffer.from(payload, "base64url").toString()) as { orgId: string; userId: string; sha256: string; fileName: string; at: number };
  if (data.orgId !== orgId || data.userId !== userId || Date.now() - data.at > 24 * 3600_000) throw expired;
  return data;
}

async function assertCanImport(tx: Tx, principal: Principal, clientOrgId: string) {
  const client = await clientOf(tx, clientOrgId);
  assertAllowed(principal, "indicator.report", resource(principal, clientOrgId));
  if (client.status !== "active") throw new BadRequestError("this client is archived");
  const { rows } = await tx.execute<{ mode: DataMode }>(sql`select app_kpi_data_mode(${clientOrgId}::uuid)::text as mode`);
  if (rows[0]?.mode === "typed") throw new BadRequestError("this client shares no files for its indicators");
}

/** What the review screen needs before any file: the indicators and their current values. */
export async function importContext(tx: Tx, principal: Principal, clientOrgId: string) {
  await assertCanImport(tx, principal, clientOrgId);
  const indicators = await indicatorRefs(tx, clientOrgId);
  const current = await currentValues(tx, clientOrgId);
  return {
    today: firmToday(),
    indicators,
    current: [...current].map(([key, v]) => ({ key, ...v })),
  };
}

export type IndicatorImportContext = Awaited<ReturnType<typeof importContext>>;

/** Read a checked, scanned Excel or CSV file into its sheets. Nothing is stored. */
export async function parseIndicatorFile(tx: Tx, principal: Principal, clientOrgId: string, file: PreparedUpload) {
  await assertCanImport(tx, principal, clientOrgId);
  let sheets: { name: string; rows: string[][] }[];
  try {
    if (file.contentType === XLSX) sheets = readXlsx(file.bytes).map((s) => ({ name: s.name, rows: s.rows }));
    else if (file.contentType === "text/csv") sheets = [{ name: file.fileName, rows: readCsv(new TextDecoder("utf-8").decode(file.bytes)) }];
    else throw new BadRequestError("file rejected: type");
  } catch (err) {
    if (err instanceof OfficeFileError) throw new BadRequestError(`file rejected: ${err.reason === "not_office" ? "type" : err.reason}`);
    throw err;
  }
  sheets = sheets.filter((s) => s.rows.length > 1);
  if (!sheets.length) throw new BadRequestError("nothing to import");
  await audit(tx, {
    actorId: principal.userId,
    orgId: principal.orgId,
    action: "indicator.import_read",
    resourceType: "organization",
    resourceId: clientOrgId,
    outcome: "allow",
    meta: { sha256: file.sha256, sizeBytes: file.bytes.byteLength, scanned: file.scanned, sheets: sheets.length },
  });
  return {
    token: signFile({ orgId: clientOrgId, userId: principal.userId, sha256: file.sha256, fileName: file.fileName }),
    fileName: file.fileName,
    // A sheet past a few thousand rows is not an indicator report.
    sheets: sheets.map((s) => ({ name: s.name, rows: s.rows.slice(0, 3000).map((r) => r.slice(0, 200)) })),
  };
}

export interface ConfirmImportInput {
  token: string;
  corrections: boolean;
  values: { line: number; label: string; kpiId: string; period: string; value: number; note: string | null }[];
}

/** Save what a person reviewed. Every figure is checked again here against the database, not the browser. */
export async function confirmIndicatorImport(tx: Tx, principal: Principal, clientOrgId: string, input: ConfirmImportInput) {
  const file = verifyFile(input.token, clientOrgId, principal.userId);
  await assertCanImport(tx, principal, clientOrgId);
  if (input.values.length > MAX_IMPORT_VALUES) throw new BadRequestError("too many values");
  const indicators = await indicatorRefs(tx, clientOrgId);
  const known = new Set(indicators.map((k) => k.id));
  const labelMap: Record<string, string | null> = {};
  const values = input.values.map((v) => {
    if (!known.has(v.kpiId)) throw new NotFoundError("indicator");
    // Each figure carries the indicator the person matched it to.
    const label = `${v.kpiId}`;
    labelMap[label] = v.kpiId;
    return { line: v.line, label, period: v.period, value: v.value, note: v.note };
  });
  const plan = planValues(values, labelMap, indicators, await currentValues(tx, clientOrgId), { today: firmToday(), corrections: input.corrections });
  if (plan.some((p) => p.issue && p.issue !== "keep")) throw new BadRequestError("rows with errors: review the file again");
  return saveBatch(tx, principal, clientOrgId, plan, { channel: "file", fileName: file.fileName, sha256: file.sha256 });
}

// ------------------------------------------------------------ connections

export async function connectSheet(tx: Tx, principal: Principal, clientOrgId: string, input: { label: string; url: string }) {
  await clientOf(tx, clientOrgId);
  assertAllowed(principal, "indicator.data", resource(principal, clientOrgId));
  const url = sheetCsvUrl(input.url, extraSheetHosts());
  if (!url) throw new BadRequestError("not a sheet link");
  const [row] = await tx
    .insert(indicatorFeeds)
    .values({ orgId: clientOrgId, kind: "sheet", label: input.label, url, runAs: principal.userId })
    .returning({ id: indicatorFeeds.id });
  await audit(tx, {
    actorId: principal.userId,
    orgId: principal.orgId,
    action: "indicator.feed_connect",
    resourceType: "organization",
    resourceId: clientOrgId,
    outcome: "allow",
    meta: { feed: row!.id, kind: "sheet" },
  });
  return { id: row!.id };
}

/** A key for the client's systems. Shown once: only its hash is kept. */
export async function createFeedKey(tx: Tx, principal: Principal, clientOrgId: string, input: { label: string }) {
  await clientOf(tx, clientOrgId);
  assertAllowed(principal, "indicator.data", resource(principal, clientOrgId));
  const token = `slk_${randomBytes(32).toString("base64url")}`;
  const [row] = await tx
    .insert(indicatorFeeds)
    .values({ orgId: clientOrgId, kind: "api", label: input.label, tokenHash: hashOf(token), tokenHint: token.slice(-4), runAs: principal.userId })
    .returning({ id: indicatorFeeds.id });
  await audit(tx, {
    actorId: principal.userId,
    orgId: principal.orgId,
    action: "indicator.feed_connect",
    resourceType: "organization",
    resourceId: clientOrgId,
    outcome: "allow",
    meta: { feed: row!.id, kind: "api" },
  });
  return { id: row!.id, token };
}

export async function disconnectFeed(tx: Tx, principal: Principal, feedId: string) {
  const [f] = await tx.select({ orgId: indicatorFeeds.orgId }).from(indicatorFeeds).where(eq(indicatorFeeds.id, feedId));
  if (!f) throw new NotFoundError("connection");
  assertAllowed(principal, "indicator.data", resource(principal, f.orgId));
  const done = await tx
    .update(indicatorFeeds)
    .set({ revokedAt: new Date(), revokedBy: principal.userId })
    .where(and(eq(indicatorFeeds.id, feedId), isNull(indicatorFeeds.revokedAt)))
    .returning({ id: indicatorFeeds.id });
  if (!done.length) throw new NotFoundError("connection");
  await audit(tx, {
    actorId: principal.userId,
    orgId: principal.orgId,
    action: "indicator.feed_revoke",
    resourceType: "organization",
    resourceId: f.orgId,
    outcome: "allow",
    meta: { feed: feedId },
  });
  return { ok: true };
}

/**
 * Fetch a sheet's CSV: https only, on allowed hosts at every redirect, at
 * most 2 MB, within 15 seconds. Never a host the firm did not allow, so a
 * pasted link can't reach the server's own network.
 */
export async function fetchSheet(url: string, extraHosts = extraSheetHosts()): Promise<string> {
  let next = url;
  for (let hop = 0; hop < 4; hop++) {
    const u = new URL(next);
    if (u.protocol !== "https:" || !sheetHostAllowed(u.hostname, extraHosts)) throw new SheetError("host");
    const res = await fetch(u, { redirect: "manual", signal: AbortSignal.timeout(15_000), headers: { accept: "text/csv,text/plain" } }).catch(() => {
      throw new SheetError("unreachable");
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) throw new SheetError("unreachable");
      next = new URL(loc, u).toString();
      continue;
    }
    if (res.status === 401 || res.status === 403 || res.status === 404) throw new SheetError("not_shared");
    if (!res.ok) throw new SheetError("unreachable");
    const type = res.headers.get("content-type") ?? "";
    // A sheet that is not shared answers with a sign-in page.
    if (type.includes("text/html")) throw new SheetError("not_shared");
    const length = Number(res.headers.get("content-length") ?? 0);
    if (length > MAX_SHEET_BYTES) throw new SheetError("too_large");
    const reader = res.body?.getReader();
    if (!reader) throw new SheetError("unreachable");
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_SHEET_BYTES) {
        await reader.cancel();
        throw new SheetError("too_large");
      }
      chunks.push(value);
    }
    return new TextDecoder("utf-8").decode(Buffer.concat(chunks));
  }
  throw new SheetError("unreachable");
}

export class SheetError extends Error {
  constructor(readonly reason: "host" | "unreachable" | "not_shared" | "too_large" | "empty") {
    super(`sheet: ${reason}`);
  }
}

/**
 * One read of a sheet: every figure it holds for the indicators the client
 * lets connections fill, matched by code or name, added or (when the sheet
 * restates a month) corrected. The result is recorded on the connection.
 */
export async function runSheet(tx: Tx, principal: Principal, feed: { id: string; orgId: string; url: string }, csv: string) {
  const rows = readCsv(csv);
  if (rows.length < 2) throw new SheetError("empty");
  const indicators = await indicatorRefs(tx, feed.orgId);
  const read = readValues(rows, detectShape(rows));
  const labelMap = matchLabels([...new Set(read.map((v) => v.label))], indicators);
  const plan = planValues(read.slice(0, MAX_IMPORT_VALUES), labelMap, indicators, await currentValues(tx, feed.orgId), {
    today: firmToday(),
    corrections: true,
    connection: true,
  });
  const out = await saveBatch(tx, principal, feed.orgId, plan, { channel: "sheet", feedId: feed.id });
  await tx.execute(sql`select app_indicator_feed_result(${feed.id}::uuid, true, null, ${out.add + out.correct})`);
  return { ...out, unmatched: [...new Set(plan.filter((p) => p.issue === "unmatched").map((p) => p.label))].slice(0, 20) };
}

/** "Read now" on the data page: the sheet read at once, by its own person or the client's admin. */
export async function readSheetNow(tx: Tx, principal: Principal, feedId: string) {
  const [f] = await tx
    .select({ id: indicatorFeeds.id, orgId: indicatorFeeds.orgId, url: indicatorFeeds.url, kind: indicatorFeeds.kind, runAs: indicatorFeeds.runAs, revokedAt: indicatorFeeds.revokedAt })
    .from(indicatorFeeds)
    .where(eq(indicatorFeeds.id, feedId));
  if (!f || f.kind !== "sheet" || f.revokedAt) throw new NotFoundError("connection");
  assertAllowed(principal, "indicator.data", resource(principal, f.orgId));
  // Values come in the connection's own name; someone else reading it now only checks the link.
  if (f.runAs !== principal.userId) throw new BadRequestError("only the person who connected this sheet can read it now");
  let csv: string;
  try {
    csv = await fetchSheet(f.url!);
  } catch (err) {
    if (err instanceof SheetError) {
      await tx.execute(sql`select app_indicator_feed_result(${f.id}::uuid, false, ${err.reason}, 0)`);
      return { ok: false as const, reason: err.reason };
    }
    throw err;
  }
  return { ok: true as const, ...(await runSheet(tx, principal, { id: f.id, orgId: f.orgId, url: f.url! }, csv)) };
}

/** What a sheet link shows before it is saved: whether it can be read, and which indicators it matches. */
export async function previewSheet(tx: Tx, principal: Principal, clientOrgId: string, link: string) {
  await clientOf(tx, clientOrgId);
  assertAllowed(principal, "indicator.data", resource(principal, clientOrgId));
  const url = sheetCsvUrl(link, extraSheetHosts());
  if (!url) return { ok: false as const, reason: "host" as const };
  let csv: string;
  try {
    csv = await fetchSheet(url);
  } catch (err) {
    if (err instanceof SheetError) return { ok: false as const, reason: err.reason };
    throw err;
  }
  const rows = readCsv(csv);
  const shape = detectShape(rows);
  const read = readValues(rows, shape);
  const indicators = await indicatorRefs(tx, clientOrgId);
  const labels = [...new Set(read.map((v) => v.label))];
  const matched = matchLabels(labels, indicators);
  return {
    ok: true as const,
    layout: shape.layout,
    values: read.length,
    labels: labels.slice(0, 50).map((l) => ({ label: l, kpiId: matched[l] ?? null })),
  };
}

// ------------------------------------------------------------ the client's systems

/** The connection behind a key, while it works. Runs with no user (the key is the only proof). */
export async function feedByKey(tx: Tx, token: string) {
  if (!/^slk_[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const { rows } = await tx.execute<{ id: string; org_id: string; run_as: string }>(sql`select id, org_id, run_as from app_indicator_feed_by_token(${hashOf(token)})`);
  const r = rows[0];
  return r ? { id: r.id, orgId: r.org_id, runAs: r.run_as } : null;
}

export interface PushedValue {
  indicator: string;
  period: string;
  value: number | string;
  note?: string | null;
}

/**
 * Figures a client's system sent with its key, saved in the name of whoever
 * created the key, for indicators the client lets connections fill. A
 * figure for a period that already has a different one corrects it (the
 * system is the source). Each figure's outcome comes back.
 */
export async function pushValues(tx: Tx, principal: Principal, feed: { id: string; orgId: string }, values: PushedValue[]) {
  const indicators = await indicatorRefs(tx, feed.orgId);
  const byKey = new Map<string, string>();
  for (const k of indicators) {
    byKey.set(k.id, k.id);
    if (k.code) byKey.set(k.code, k.id);
  }
  const labelMap: Record<string, string | null> = {};
  const read = values.map((v, i) => {
    const label = String(v.indicator).trim().toLowerCase();
    labelMap[label] = byKey.get(label) ?? null;
    const value = typeof v.value === "number" ? v.value : parseNumber(v.value);
    return { line: i + 1, label, period: parsePeriod(String(v.period)), value, note: v.note?.trim() || null };
  });
  const plan = planValues(read, labelMap, indicators, await currentValues(tx, feed.orgId), { today: firmToday(), corrections: true, connection: true });
  const out = await saveBatch(tx, principal, feed.orgId, plan, { channel: "api", feedId: feed.id });
  await tx.execute(sql`select app_indicator_feed_result(${feed.id}::uuid, true, null, ${out.add + out.correct})`);
  return {
    added: out.add,
    corrected: out.correct,
    unchanged: out.same,
    results: plan.map((p) => ({ index: p.line - 1, status: p.status ?? "refused", reason: p.issue })),
  };
}

/** Feeds a daily job reads: sheets still working, for active clients still "connected". Schema owner only. */
export const DUE_SHEETS_SQL = `
  SELECT f.id, f.org_id, f.run_as, f.url FROM indicator_feeds f JOIN organizations o ON o.id = f.org_id
  WHERE f.kind = 'sheet' AND f.revoked_at IS NULL AND o.status = 'active' AND app_kpi_data_mode(f.org_id) = 'connected'
    AND (f.last_run_at IS NULL OR f.last_run_at < now() - interval '20 hours')
  ORDER BY f.last_run_at NULLS FIRST LIMIT 200`;
