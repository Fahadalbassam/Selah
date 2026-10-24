import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { zipSync, strToU8, type Zippable } from "fflate";
import { getTranslations } from "next-intl/server";
import type { Tx } from "@/db/client";
import {
  actions,
  clientContacts,
  clientExportPacks,
  documents,
  organizations,
  projectClosureItems,
  projectClosures,
  projects,
  recommendations,
  user,
} from "@/db/schema";
import { assertAllowed, authorize, type Principal } from "@/authz";
import type { Locale } from "@/i18n/config";
import { csvCell } from "@/lib/audit";
import { localName } from "@/lib/names";
import { PACK_LABELS, PACK_MAX_BYTES, packPath } from "@/lib/offboarding";
import { createAttemptLimiter } from "@/auth/attempts";
import { ConflictError, NotFoundError, RateLimitError } from "@/server/errors";
import { audit } from "./audit";
import { downloadable } from "./scan";
import { getObject, putObject, signedDownloadUrl, DOWNLOAD_TTL_SECONDS } from "./storage";

// The export pack of a leaving client (full picture item 27, journey J14.2
// and J14.4). One ZIP: a README in Arabic and English, a manifest with each
// file's SHA-256, the projects, recommendations, actions (with how each open
// one was settled at closing) and files as CSV, and the files themselves.
// It is read under the maker's row-level security and authorize(), and holds
// only what the client may see: records shared with it or private to it,
// never the firm's own. The database decides who may make one and who gives
// the receipt (baseline: Export pack, 0033).

const resourceOf = (p: Principal, orgId: string) => ({
  type: "organization" as const,
  orgId,
  firmOrgId: p.orgKind === "firm" ? p.orgId : undefined,
  projectId: null,
});

const ZIP = "application/zip";

// A pack reads every file of a client, so three per person per ten minutes.
const packsPerPerson = createAttemptLimiter({ max: 3, windowSeconds: 10 * 60 });

function csv(rows: (string | number | null | undefined)[][]): Uint8Array {
  // UTF-8 with a byte-order mark, so a spreadsheet reads Arabic.
  return strToU8(`﻿${rows.map((r) => r.map(csvCell).join(",")).join("\r\n")}\r\n`);
}

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** Build, store and record a pack. Returns the new pack's id. Audited. */
export async function makeExportPack(tx: Tx, principal: Principal, orgId: string, locale: Locale): Promise<{ id: string }> {
  assertAllowed(principal, "organization.export", resourceOf(principal, orgId));
  const [org] = await tx
    .select({ name: organizations.name, nameAr: organizations.nameAr, status: organizations.status })
    .from(organizations)
    .where(and(eq(organizations.id, orgId), eq(organizations.kind, "client")))
    .limit(1);
  if (!org) throw new NotFoundError("client");
  if (org.status !== "archived") throw new ConflictError("only an archived client has an export pack");
  if (packsPerPerson.take(principal.userId) !== null) throw new RateLimitError("too many export packs");
  const t = await getTranslations({ locale, namespace: "offboarding.pack" });
  const ts = await getTranslations({ locale });
  const ar = locale === "ar";
  const labels = [...PACK_LABELS];

  const projectRows = await tx
    .select({
      id: projects.id,
      title: projects.title,
      state: projects.state,
      startDate: projects.startDate,
      endDate: projects.endDate,
      closedAt: projects.closedAt,
    })
    .from(projects)
    .where(and(eq(projects.orgId, orgId), sql`${projects.state}::text <> 'draft'`))
    .orderBy(asc(projects.startDate), asc(projects.title));
  const projectIds = projectRows.map((p) => p.id);
  const projectTitle = new Map(projectRows.map((p) => [p.id, p.title]));

  const recs = projectIds.length
    ? await tx
        .select({
          id: recommendations.id,
          projectId: recommendations.projectId,
          title: recommendations.title,
          priority: recommendations.priority,
          dueDate: recommendations.dueDate,
        })
        .from(recommendations)
        .where(and(inArray(recommendations.projectId, projectIds), inArray(recommendations.visibility, labels)))
        .orderBy(asc(recommendations.createdAt))
    : [];
  const recTitle = new Map(recs.map((r) => [r.id, r.title]));

  const actionRows = recs.length
    ? await tx
        .select({
          id: actions.id,
          projectId: actions.projectId,
          recommendationId: actions.recommendationId,
          title: actions.title,
          status: actions.status,
          owner: sql<string | null>`coalesce(${user.name}, ${actions.ownerName})`,
          dueDate: actions.dueDate,
          closedAt: actions.closedAt,
        })
        .from(actions)
        .leftJoin(user, eq(user.id, actions.ownerUserId))
        .where(and(inArray(actions.recommendationId, [...recTitle.keys()]), ne(actions.status, "draft")))
        .orderBy(asc(actions.createdAt))
    : [];

  // How each action still open at closing was settled, from each project's last closing round.
  const settled = actionRows.length
    ? await tx
        .select({
          actionId: projectClosureItems.actionId,
          disposition: projectClosureItems.disposition,
          note: projectClosureItems.note,
          sustainer: sql<string | null>`coalesce(su.name, ${clientContacts.name})`,
          closedAt: projectClosures.closedAt,
        })
        .from(projectClosureItems)
        .innerJoin(projectClosures, eq(projectClosures.id, projectClosureItems.closureId))
        .leftJoin(sql`"user" su`, sql`su.id = ${projectClosureItems.sustainerUserId}`)
        .leftJoin(clientContacts, eq(clientContacts.id, projectClosureItems.sustainerContactId))
        .where(and(inArray(projectClosureItems.actionId, actionRows.map((a) => a.id)), isNull(projectClosures.reopenedAt)))
        .orderBy(desc(projectClosures.startedAt))
    : [];
  const settledOf = new Map<string, (typeof settled)[number]>();
  for (const s of settled) if (!settledOf.has(s.actionId)) settledOf.set(s.actionId, s);

  // Files: the latest version of each, shared with the client or private to it,
  // cleared by the scanner, not withdrawn, and one the maker may download.
  const docRows = projectIds.length
    ? await tx
        .select({
          id: documents.id,
          projectId: documents.projectId,
          title: documents.title,
          version: documents.version,
          visibility: documents.visibility,
          contentType: documents.contentType,
          sizeBytes: documents.sizeBytes,
          sha256: documents.sha256,
          storageKey: documents.storageKey,
          scanStatus: documents.scanStatus,
          createdAt: documents.createdAt,
          uploadedBy: documents.uploadedBy,
          ownerOrgId: documents.ownerOrgId,
          departmentId: documents.departmentId,
          uploader: user.name,
          kind: projects.kind,
          firmOrgId: projects.firmOrgId,
          state: projects.state,
          mode: organizations.engagementMode,
        })
        .from(documents)
        .innerJoin(projects, eq(projects.id, documents.projectId))
        .innerJoin(organizations, eq(organizations.id, documents.orgId))
        .leftJoin(user, eq(user.id, documents.uploadedBy))
        .where(
          and(
            inArray(documents.projectId, projectIds),
            inArray(documents.visibility, labels),
            ne(documents.state, "archived"),
            isNull(documents.withdrawnAt),
            sql`not exists (select 1 from documents n where n.supersedes_id = ${documents.id})`,
          ),
        )
        .orderBy(asc(documents.createdAt))
    : [];
  const readable = docRows.filter(
    (d) =>
      downloadable(d.scanStatus) &&
      authorize(principal, "document.download", {
        type: "document",
        id: d.id,
        orgId,
        firmOrgId: d.firmOrgId,
        projectId: d.projectId,
        projectKind: d.kind,
        projectState: d.state,
        engagementMode: d.mode,
        visibility: d.visibility,
        createdBy: d.uploadedBy,
        sharedWith: [],
        ownerOrgId: d.ownerOrgId,
        departmentId: d.departmentId,
      }).allowed,
  );

  const zip: Zippable = {};
  const manifest: { path: string; sha256: string; bytes: number }[] = [];
  const put = (path: string, bytes: Uint8Array, level: 0 | 6 = 6) => {
    zip[path] = [bytes, { level }];
    manifest.push({ path, sha256: sha256(bytes), bytes: bytes.byteLength });
  };

  const used = new Set<string>();
  let packed = 0;
  let total = 0;
  const fileLines: (string | number | null)[][] = [];
  for (const d of readable) {
    const project = projectTitle.get(d.projectId) ?? "";
    let where: string;
    if (total + d.sizeBytes > PACK_MAX_BYTES) {
      where = t("notPacked");
    } else {
      const bytes = await getObject(d.storageKey);
      // The stored file must still be the one that was uploaded.
      if (sha256(bytes) !== d.sha256) throw new Error(`stored file ${d.id} does not match its checksum`);
      where = packPath(used, { project, title: d.title, version: d.version, contentType: d.contentType });
      put(where, bytes, 0);
      total += d.sizeBytes;
      packed++;
    }
    fileLines.push([
      project,
      d.title,
      d.version,
      ts(`files.visibility.${d.visibility}` as "files.visibility.shared"),
      d.uploader,
      d.createdAt.toISOString().slice(0, 10),
      d.sizeBytes,
      d.sha256,
      where,
    ]);
  }

  const status = (s: string) => ts(`status.${s}` as "status.draft");
  put(
    "projects.csv",
    csv([
      [t("csv.project"), t("csv.state"), t("csv.start"), t("csv.end"), t("csv.closed")],
      ...projectRows.map((p) => [
        p.title,
        ts(`phases.states.${p.state}` as "phases.states.active"),
        p.startDate,
        p.endDate,
        p.closedAt?.toISOString().slice(0, 10) ?? null,
      ]),
    ]),
  );
  put(
    "recommendations.csv",
    csv([
      [t("csv.project"), t("csv.recommendation"), t("csv.priority"), t("csv.due")],
      ...recs.map((r) => [projectTitle.get(r.projectId) ?? "", r.title, ts(`priority.${r.priority}` as "priority.medium"), r.dueDate]),
    ]),
  );
  put(
    "actions.csv",
    csv([
      [t("csv.project"), t("csv.recommendation"), t("csv.action"), t("csv.status"), t("csv.owner"), t("csv.due"), t("csv.done"), t("csv.disposition"), t("csv.sustainer"), t("csv.dispositionNote")],
      ...actionRows.map((a) => {
        const s = settledOf.get(a.id);
        return [
          projectTitle.get(a.projectId) ?? "",
          recTitle.get(a.recommendationId) ?? "",
          a.title,
          status(a.status),
          a.owner,
          a.dueDate,
          a.closedAt?.toISOString().slice(0, 10) ?? null,
          s ? ts(`closure.dispositions.${s.disposition}` as "closure.dispositions.handed_over") : null,
          s?.sustainer ?? null,
          s?.note ?? null,
        ];
      }),
    ]),
  );
  put(
    "files.csv",
    csv([
      [t("csv.project"), t("csv.file"), t("csv.version"), t("csv.label"), t("csv.uploadedBy"), t("csv.uploaded"), t("csv.bytes"), t("csv.sha256"), t("csv.path")],
      ...fileLines,
    ]),
  );

  const [maker] = await tx.select({ name: user.name }).from(user).where(eq(user.id, principal.userId)).limit(1);
  const madeAt = new Date();
  const clientName = localName(org, ar);
  const [readmeAr, readmeEn] = await Promise.all(
    (["ar", "en"] as const).map(async (l) => {
      const tl = await getTranslations({ locale: l, namespace: "offboarding.pack" });
      return tl("readme", {
        client: localName(org, l === "ar"),
        date: madeAt.toISOString().slice(0, 10),
        maker: maker?.name ?? "",
        projects: projectRows.length,
        actions: actionRows.length,
        files: packed,
        skipped: readable.length - packed,
      });
    }),
  );
  put("README.txt", strToU8(`﻿${readmeAr}\r\n\r\n----\r\n\r\n${readmeEn}\r\n`));
  // The manifest lists every entry above with its checksum; it can't list itself.
  const manifestBytes = strToU8(
    JSON.stringify(
      { client: clientName, clientId: orgId, madeAt: madeAt.toISOString(), madeBy: maker?.name ?? null, locale, files: manifest },
      null,
      2,
    ),
  );
  zip["manifest.json"] = [manifestBytes, { level: 6 }];

  const bytes = zipSync(zip);
  const hash = sha256(bytes);
  const id = randomUUID();
  const key = `exports/${id}.zip`;
  await putObject(key, bytes, ZIP, hash);
  const rows = await tx.execute<{ id: string }>(
    sql`select app_record_export_pack(${orgId}, ${key}, ${hash}, ${bytes.byteLength}, ${packed}, ${locale}) as id`,
  );
  const packId = rows.rows[0]!.id;
  await audit(tx, {
    actorId: principal.userId,
    orgId: principal.orgId,
    action: "client.pack_make",
    resourceType: "organization",
    resourceId: orgId,
    outcome: "allow",
    meta: { pack: packId, files: packed, skipped: readable.length - packed, bytes: bytes.byteLength },
  });
  return { id: packId };
}

/** The packs made for a client, with their receipts. */
export async function listExportPacks(tx: Tx, principal: Principal, orgId: string) {
  if (!authorize(principal, "organization.export", resourceOf(principal, orgId)).allowed) return [];
  const rows = await tx
    .select({
      id: clientExportPacks.id,
      madeAt: clientExportPacks.madeAt,
      madeBy: clientExportPacks.madeBy,
      locale: clientExportPacks.locale,
      sha256: clientExportPacks.sha256,
      sizeBytes: clientExportPacks.sizeBytes,
      fileCount: clientExportPacks.fileCount,
      receiptBy: clientExportPacks.receiptBy,
      receiptAt: clientExportPacks.receiptAt,
      receivedByName: clientExportPacks.receivedByName,
      receiptNote: clientExportPacks.receiptNote,
    })
    .from(clientExportPacks)
    .where(eq(clientExportPacks.orgId, orgId))
    .orderBy(desc(clientExportPacks.madeAt));
  const ids = [...new Set(rows.flatMap((r) => [r.madeBy, r.receiptBy]).filter((x): x is string => !!x))];
  const names = new Map<string, string>();
  if (ids.length) for (const u of await tx.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, ids))) names.set(u.id, u.name);
  return rows.map((r) => ({
    ...r,
    madeBy: r.madeBy ? (names.get(r.madeBy) ?? null) : null,
    receiptBy: r.receiptBy ? (names.get(r.receiptBy) ?? null) : null,
  }));
}

export type ExportPackRow = Awaited<ReturnType<typeof listExportPacks>>[number];

async function loadPack(tx: Tx, principal: Principal, orgId: string, packId: string) {
  assertAllowed(principal, "organization.export", resourceOf(principal, orgId));
  const [pack] = await tx
    .select({ id: clientExportPacks.id, orgId: clientExportPacks.orgId, storageKey: clientExportPacks.storageKey, madeAt: clientExportPacks.madeAt })
    .from(clientExportPacks)
    .where(eq(clientExportPacks.id, packId))
    .limit(1);
  if (!pack || pack.orgId !== orgId) throw new NotFoundError("export pack");
  return pack;
}

/** A one-minute link to a pack. Audited. */
export async function exportPackLink(tx: Tx, principal: Principal, orgId: string, packId: string, ip: string | null) {
  const pack = await loadPack(tx, principal, orgId, packId);
  const url = await signedDownloadUrl(pack.storageKey, `selah-export-${pack.madeAt.toISOString().slice(0, 10)}.zip`);
  await audit(tx, {
    actorId: principal.userId,
    orgId: principal.orgId,
    action: "client.pack_download",
    resourceType: "organization",
    resourceId: orgId,
    outcome: "allow",
    ip,
    meta: { pack: packId },
  });
  return { url, expiresIn: DOWNLOAD_TTL_SECONDS };
}

/**
 * The receipt. The client's admin confirms receiving the pack; the firm admin
 * records a handover made outside Selah and names who received it. Once only.
 */
export async function recordReceipt(
  tx: Tx,
  principal: Principal,
  orgId: string,
  packId: string,
  input: { receivedBy?: string | null; note?: string | null },
) {
  await loadPack(tx, principal, orgId, packId);
  if (principal.orgKind === "firm") {
    await tx.execute(sql`select app_record_export_handover(${packId}, ${input.receivedBy ?? ""}, ${input.note ?? ""})`);
  } else {
    await tx.execute(sql`select app_confirm_export_receipt(${packId}, ${input.note ?? ""})`);
  }
  await audit(tx, {
    actorId: principal.userId,
    orgId: principal.orgId,
    action: "client.pack_receipt",
    resourceType: "organization",
    resourceId: orgId,
    outcome: "allow",
    meta: { pack: packId, by: principal.orgKind === "firm" ? "firm" : "client" },
  });
  return listExportPacks(tx, principal, orgId);
}
