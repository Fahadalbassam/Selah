import "server-only";
import { sql } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import type { Tx } from "@/db/client";
import { assertAllowed, type Principal } from "@/authz";
import type { Locale } from "@/i18n/config";
import { AUDIT_AREAS, AUDIT_EXPORT_MAX, AUDIT_PAGE_SIZE, auditActionKey, auditAreaOf, csvCell, type AuditArea, type AuditOutcome } from "@/lib/audit";
import { firmToday } from "@/lib/dates";
import { audit } from "./audit";
import type { ExportFile } from "./exports";

// The audit-log screen and its export (R2). The database decides what each
// admin may read (app_audit_entries): the firm admin everything, a client
// admin their own people's events with refusals' details held back. The
// permission check here gives everyone else a clear 404 first.

export interface AuditFilters {
  /** Inclusive day, YYYY-MM-DD, in the firm's time zone. */
  from?: string;
  /** Inclusive day, YYYY-MM-DD. */
  to?: string;
  person?: string;
  area?: AuditArea;
  outcome?: AuditOutcome;
  org?: string;
}

export interface AuditEntry {
  id: string;
  createdAt: Date;
  actorId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  actorOrg: string | null;
  actorOrgAr: string | null;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  outcome: AuditOutcome;
  reason: string | null;
  ip: string | null;
  meta: Record<string, unknown>;
  chainSeq: number | null;
}

const resource = (p: Principal) => ({ type: "organization" as const, orgId: p.orgId, firmOrgId: p.orgId, projectId: null });

// Days are the firm's (Asia/Riyadh): the window runs from the start of `from` to the end of `to`.
const dayStart = (d: string | undefined) => (d ? sql`(${d}::date::timestamp AT TIME ZONE app_firm_tz())` : sql`NULL::timestamptz`);
const dayEnd = (d: string | undefined) => (d ? sql`((${d}::date + 1)::timestamp AT TIME ZONE app_firm_tz())` : sql`NULL::timestamptz`);

async function entries(tx: Tx, f: AuditFilters, limit: number, offset: number) {
  const areas = f.area ? sql`${`{${AUDIT_AREAS[f.area].join(",")}}`}::text[]` : sql`NULL::text[]`;
  const { rows } = await tx.execute<Record<string, unknown>>(sql`
    select * from app_audit_entries(${dayStart(f.from)}, ${dayEnd(f.to)}, ${f.person ?? null}::uuid, ${areas},
      ${f.outcome ?? null}::text, ${f.org ?? null}::uuid, ${limit}, ${offset})`);
  const total = rows.length ? Number(rows[0]!.total) : 0;
  const list: AuditEntry[] = rows.map((r) => ({
    id: r.id as string,
    createdAt: new Date(r.created_at as string),
    actorId: (r.actor_id as string | null) ?? null,
    actorName: (r.actor_name as string | null) ?? null,
    actorEmail: (r.actor_email as string | null) ?? null,
    actorOrg: (r.actor_org as string | null) ?? null,
    actorOrgAr: (r.actor_org_ar as string | null) ?? null,
    action: r.action as string,
    resourceType: (r.resource_type as string | null) ?? null,
    resourceId: (r.resource_id as string | null) ?? null,
    outcome: r.outcome as AuditOutcome,
    reason: (r.reason as string | null) ?? null,
    ip: (r.ip as string | null) ?? null,
    meta: (r.meta as Record<string, unknown>) ?? {},
    chainSeq: r.chain_seq == null ? null : Number(r.chain_seq),
  }));
  return { list, total };
}

/** One page of the log, newest first, with the people and organizations for the filters. */
export async function listAuditEntries(tx: Tx, principal: Principal, filters: AuditFilters, page: number) {
  assertAllowed(principal, "audit_log.read", resource(principal));
  const { list, total } = await entries(tx, filters, AUDIT_PAGE_SIZE, (page - 1) * AUDIT_PAGE_SIZE);
  const people = await tx.execute<{ id: string; name: string; email: string; org_id: string }>(sql`select * from app_audit_people()`);
  const firm = principal.orgKind === "firm";
  const orgs = firm
    ? (
        await tx.execute<{ id: string; name: string; name_ar: string | null; kind: string }>(
          sql`select id, name, name_ar, kind::text from organizations where kind = 'firm' or (kind = 'client' and not prospect) order by kind, name`,
        )
      ).rows.map((o) => ({ id: o.id, name: o.name, nameAr: o.name_ar, firm: o.kind === "firm" }))
    : [];
  return {
    entries: list,
    total,
    firm,
    people: people.rows.map((p) => ({ id: p.id, name: p.name, email: p.email, orgId: p.org_id })),
    orgs,
  };
}

/** The chain's state for the firm admin's status card; null for a client admin. */
export async function auditChainStatus(tx: Tx, principal: Principal) {
  assertAllowed(principal, "audit_log.read", resource(principal));
  if (principal.orgKind !== "firm") return null;
  const { rows } = await tx.execute<Record<string, unknown>>(sql`select * from app_audit_chain_status()`);
  const r = rows[0];
  if (!r) return null;
  return {
    checkedAt: r.checked_at ? new Date(r.checked_at as string) : null,
    ok: (r.ok as boolean | null) ?? null,
    rowsChecked: r.rows_checked == null ? null : Number(r.rows_checked),
    firstBadSeq: r.first_bad_seq == null ? null : Number(r.first_bad_seq),
    headSeq: Number(r.head_seq),
    headHash: r.head_hash as string,
    unsealed: Number(r.unsealed),
    anchorSeq: Number(r.anchor_seq),
    prunedAt: r.pruned_at ? new Date(r.pruned_at as string) : null,
    keepMonths: Number(r.keep_months),
    oldest: r.oldest ? new Date(r.oldest as string) : null,
  };
}

/** The filtered log as CSV (UTF-8 with a byte-order mark, so Excel reads Arabic), in the reader's language. Audited. */
export async function exportAuditCsv(tx: Tx, principal: Principal, filters: AuditFilters, locale: Locale): Promise<ExportFile> {
  assertAllowed(principal, "audit_log.read", resource(principal));
  const { list, total } = await entries(tx, filters, AUDIT_EXPORT_MAX, 0);
  const t = await getTranslations({ locale, namespace: "audit" });
  const ar = locale === "ar";
  const label = (action: string) => {
    const key = `actions.${auditActionKey(action)}`;
    if (t.has(key)) return t(key as "actions.document_download");
    const area = auditAreaOf(action);
    return area ? t(`areas.${area}`) : action;
  };
  const head = ["time", "person", "email", "organization", "action", "actionCode", "outcome", "resourceType", "resourceId", "reason", "ip", "chainSeq", "details"];
  const lines = [head.map((h) => csvCell(t(`csv.${h}` as "csv.time"))).join(",")];
  for (const e of list) {
    lines.push(
      [
        e.createdAt.toISOString(),
        e.actorName ?? (e.actorId ? e.actorId : t("system")),
        e.actorEmail,
        (ar ? e.actorOrgAr : null) ?? e.actorOrg,
        label(e.action),
        e.action,
        t(`outcomes.${e.outcome}`),
        e.resourceType,
        e.resourceId,
        e.reason,
        e.ip,
        e.chainSeq,
        Object.keys(e.meta).length ? JSON.stringify(e.meta) : "",
      ]
        .map(csvCell)
        .join(","),
    );
  }
  if (total > list.length) lines.push(csvCell(t("csv.truncated", { shown: list.length, total })));
  await audit(tx, {
    actorId: principal.userId,
    orgId: principal.orgId,
    action: "audit_log.export",
    resourceType: "organization",
    resourceId: principal.orgId,
    outcome: "allow",
    meta: { rows: list.length, total, area: filters.area ?? null, outcome: filters.outcome ?? null },
  });
  const bytes = new TextEncoder().encode(`﻿${lines.join("\r\n")}\r\n`);
  return { bytes, fileName: `selah-audit-log-${firmToday()}.csv`, contentType: "text/csv; charset=utf-8" };
}
