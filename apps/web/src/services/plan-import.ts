import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { actions, findings, recommendations } from "@/db/schema";
import type { Principal } from "@/authz";
import { env } from "@/env";
import { firmToday } from "@/lib/dates";
import { readDocx } from "@/lib/office/docx-read";
import { readXlsx } from "@/lib/office/xlsx-read";
import { OfficeFileError } from "@/lib/office/zip";
import { checkImport, type ImportContext, type ImportOptions, type ImportRow, type ImportSource } from "@/lib/plan-import";
import { BadRequestError, NotFoundError } from "@/server/errors";
import { audit } from "./audit";
import type { PreparedUpload } from "./evidence";
import { createAction, createFinding, createRecommendation, planOptions } from "./plan";

// Importing a plan from an Excel workbook or a Word document. Two steps, and
// nothing is written until the second: the file is checked, scanned and read
// into rows (parseImport), a person reviews and fixes them, then confirms
// (confirmImport), which checks everything again and creates the records in
// one transaction through the same services as the plan dialogs.

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/**
 * What an import may use on this project, for the review screen and for the
 * server's own check: the team who can own actions, the client's departments,
 * and what the plan already holds (to reuse findings and recommendations and
 * to spot actions imported before). Null for anyone who can't write the plan.
 */
export async function importContext(tx: Tx, principal: Principal, projectId: string): Promise<ImportContext | null> {
  const options = await planOptions(tx, principal, projectId);
  if (!options || !options.can.finding || !options.can.recommendation || !options.can.action) return null;
  // The plan as it stands (RLS: the firm reads all of it).
  const [findingRows, recRows, actionRows] = await Promise.all([
    tx.select({ id: findings.id, title: findings.title }).from(findings).where(eq(findings.projectId, projectId)),
    tx
      .select({ id: recommendations.id, title: recommendations.title, findingId: recommendations.findingId })
      .from(recommendations)
      .where(eq(recommendations.projectId, projectId)),
    tx.select({ recommendationId: actions.recommendationId, title: actions.title }).from(actions).where(eq(actions.projectId, projectId)),
  ]);
  return {
    today: firmToday(),
    client: options.kind === "client",
    ownerByName: options.ownerByName,
    minimalRecords: options.minimalRecords,
    canRelease: options.can.release,
    owners: options.owners,
    departments: options.departments,
    findings: findingRows,
    recommendations: recRows,
    actions: actionRows,
  };
}

/** A signed note of the file a review came from, so the confirm's audit record names the file that was scanned, not one the browser claims. */
function signFile(file: { projectId: string; userId: string; sha256: string }): string {
  const payload = Buffer.from(JSON.stringify({ ...file, at: Date.now() })).toString("base64url");
  const mac = createHmac("sha256", env().BETTER_AUTH_SECRET).update(`plan-import:${payload}`).digest("base64url");
  return `${payload}.${mac}`;
}

function verifyFile(token: string, projectId: string, userId: string): { sha256: string } {
  const [payload, mac] = token.split(".");
  if (!payload || !mac) throw new BadRequestError("the import has expired: upload the file again");
  const expected = createHmac("sha256", env().BETTER_AUTH_SECRET).update(`plan-import:${payload}`).digest();
  const given = Buffer.from(mac, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new BadRequestError("the import has expired: upload the file again");
  const data = JSON.parse(Buffer.from(payload, "base64url").toString()) as { projectId: string; userId: string; sha256: string; at: number };
  // A review is worked through in one sitting; a day is plenty.
  if (data.projectId !== projectId || data.userId !== userId || Date.now() - data.at > 24 * 3600_000)
    throw new BadRequestError("the import has expired: upload the file again");
  return { sha256: data.sha256 };
}

/** Read an uploaded (checked and scanned) file into the places a plan can come from. Nothing is stored. */
export async function parseImport(tx: Tx, principal: Principal, projectId: string, file: PreparedUpload) {
  const ctx = await importContext(tx, principal, projectId);
  if (!ctx) throw new NotFoundError("project");
  if (file.contentType !== XLSX && file.contentType !== DOCX) throw new BadRequestError("file rejected: type");

  const sources: ImportSource[] = [];
  try {
    if (file.contentType === XLSX) {
      readXlsx(file.bytes).forEach((s, i) => sources.push({ id: `sheet-${i}`, kind: "sheet", name: s.name, rows: s.rows, truncated: s.truncated }));
    } else {
      const blocks = readDocx(file.bytes);
      if (blocks.some((b) => b.type === "heading")) sources.push({ id: "outline", kind: "outline", blocks: blocks.filter((b) => b.type !== "table") });
      blocks.forEach((b) => {
        if (b.type === "table") sources.push({ id: `table-${sources.length}`, kind: "table", n: sources.filter((s) => s.kind === "table").length + 1, rows: b.rows });
      });
    }
  } catch (err) {
    if (err instanceof OfficeFileError) throw new BadRequestError(`file rejected: ${err.reason === "not_office" ? "type" : err.reason}`);
    throw err;
  }
  if (!sources.length) throw new BadRequestError("nothing to import");

  await audit(tx, {
    actorId: principal.userId,
    orgId: principal.orgId,
    action: "plan.import.read",
    resourceType: "project",
    resourceId: projectId,
    outcome: "allow",
    meta: { sha256: file.sha256, sizeBytes: file.bytes.byteLength, scanned: file.scanned, sources: sources.length },
  });
  return {
    token: signFile({ projectId, userId: principal.userId, sha256: file.sha256 }),
    fileName: file.fileName,
    kind: file.contentType === XLSX ? ("xlsx" as const) : ("docx" as const),
    sources,
  };
}

export interface ConfirmInput {
  token: string;
  rows: Pick<ImportRow, "line" | "values">[];
  options: ImportOptions;
}

/**
 * Create what the reviewed rows describe, all or nothing. The rows are
 * checked again here against the project as it is now; any row with an
 * error refuses the whole import, so the screen and the result never differ.
 */
export async function confirmImport(tx: Tx, principal: Principal, projectId: string, input: ConfirmInput) {
  const ctx = await importContext(tx, principal, projectId);
  if (!ctx) throw new NotFoundError("project");
  const file = verifyFile(input.token, projectId, principal.userId);
  const rows: ImportRow[] = input.rows.map((r) => ({ line: r.line, values: r.values, include: true, filled: [] }));
  if (new Set(rows.map((r) => r.line)).size !== rows.length) throw new BadRequestError("invalid input");
  // Visibility only means something on a client project; releasing needs the right to (ctx.canRelease).
  const options: ImportOptions = { ...input.options, visibility: ctx.client ? input.options.visibility : "shared" };
  const check = checkImport(rows, ctx, options);
  if (check.tooMany) throw new BadRequestError("too many rows");
  if (check.counts.withErrors) throw new BadRequestError(`rows with errors: ${check.rows.filter((r) => r.errors.length).map((r) => r.line).join(",")}`);
  if (!check.plan.findings.length && !check.plan.recommendations.length) throw new BadRequestError("nothing to import");

  const findingIds = new Map<string, string>();
  for (const f of check.plan.findings) {
    findingIds.set(
      f.key,
      f.existingId ?? (await createFinding(tx, principal, projectId, { title: f.title, description: f.description, visibility: options.visibility })).id,
    );
  }
  const recIds = new Map<string, string>();
  for (const r of check.plan.recommendations) {
    if (r.existingId) {
      recIds.set(r.key, r.existingId);
      continue;
    }
    const row = await createRecommendation(tx, principal, projectId, {
      title: r.title,
      findingId: r.findingKey ? findingIds.get(r.findingKey) : undefined,
      rationale: r.rationale,
      targetOutcome: r.targetOutcome,
      priority: r.priority,
      dueDate: r.dueDate,
      requiredEvidence: r.requiredEvidence,
      source: "consultant",
      visibility: options.visibility,
    });
    recIds.set(r.key, row.id);
  }
  for (const a of check.plan.actions) {
    await createAction(
      tx,
      principal,
      recIds.get(a.recommendationKey)!,
      {
        title: a.title,
        description: a.description,
        ownerUserId: a.ownerUserId,
        ownerName: a.ownerName,
        departmentId: a.departmentId,
        dueDate: a.dueDate,
        evidence: a.evidence.map((title) => ({ title })),
        release: a.release,
      },
      { import: true },
    );
  }

  await audit(tx, {
    actorId: principal.userId,
    orgId: principal.orgId,
    action: "plan.import",
    resourceType: "project",
    resourceId: projectId,
    outcome: "allow",
    // The rows are the reviewed ones (people fix rows before confirming), read
    // from the file with this hash: not the file imported word for word.
    meta: {
      sha256: file.sha256,
      source: "reviewed rows",
      findings: check.counts.findings,
      recommendations: check.counts.recommendations,
      actions: check.counts.actions,
      released: check.counts.released,
      visibility: options.visibility,
    },
  });
  return { counts: check.counts };
}
