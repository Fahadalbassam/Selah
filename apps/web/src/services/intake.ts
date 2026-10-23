import "server-only";
import { createHmac } from "node:crypto";
import { asc, eq, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { sectors, serviceAreas } from "@/db/schema";
import { env } from "@/env";
import { EMPLOYEE_BANDS, HEARD_FROM, OWNERSHIP_TYPES, PRIVACY_NOTICE_VERSION, URGENCIES } from "@/lib/intake";

// The public side of intake. The database does the real checks in
// submit_inquiry() (baseline: Intake); this module only shapes
// the request and keeps raw addresses out of the database.

export interface InquiryInput {
  orgName: string;
  orgNameAr?: string;
  crNumber?: string;
  sector: string;
  employeeBand: (typeof EMPLOYEE_BANDS)[number];
  ownershipType: (typeof OWNERSHIP_TYPES)[number];
  contactName: string;
  contactRole?: string;
  email: string;
  phone?: string;
  preferredLanguage: "ar" | "en";
  services: string[];
  message?: string;
  selfCheck: Partial<Record<"hasStrategy" | "hasOrgChart" | "hasDelegationMatrix" | "hasPolicies" | "hasSops" | "hasKpis", boolean>>;
  urgency?: (typeof URGENCIES)[number];
  heardFrom?: (typeof HEARD_FROM)[number];
  consent: true;
  privacyNoticeVersion: string;
}

/** A keyed hash, so repeat submissions can be counted without storing who sent them. */
function fingerprint(kind: string, value: string | null): string | null {
  return value ? createHmac("sha256", env().BETTER_AUTH_SECRET).update(`${kind}:${value}`).digest("hex") : null;
}

export async function submitInquiry(tx: Tx, input: InquiryInput, ip: string | null, userAgent: string | null) {
  const s = input.selfCheck;
  const payload = {
    org_name: input.orgName,
    org_name_ar: input.orgNameAr,
    cr_number: input.crNumber,
    sector: input.sector,
    employee_band: input.employeeBand,
    ownership_type: input.ownershipType,
    contact_name: input.contactName,
    contact_role: input.contactRole,
    email: input.email,
    phone: input.phone,
    preferred_language: input.preferredLanguage,
    services: input.services,
    message: input.message,
    self_check: {
      has_strategy: s.hasStrategy,
      has_org_chart: s.hasOrgChart,
      has_delegation_matrix: s.hasDelegationMatrix,
      has_policies: s.hasPolicies,
      has_sops: s.hasSops,
      has_kpis: s.hasKpis,
    },
    urgency: input.urgency,
    heard_from: input.heardFrom,
    consent: input.consent,
    privacy_notice_version: input.privacyNoticeVersion,
    ip_hash: fingerprint("intake-ip", ip),
    user_agent_hash: fingerprint("intake-ua", userAgent),
  };
  const { rows } = await tx.execute<{ ref: string }>(sql`select submit_inquiry(${JSON.stringify(payload)}::jsonb) as ref`);
  return { ref: rows[0]!.ref };
}

/** What the form offers: the active services and sectors, and the fixed choices. */
export async function intakeOptions(tx: Tx) {
  const list = { code: serviceAreas.code, nameAr: serviceAreas.nameAr, nameEn: serviceAreas.nameEn };
  const services = await tx.select(list).from(serviceAreas).where(eq(serviceAreas.active, true)).orderBy(asc(serviceAreas.sortOrder));
  const sectorList = await tx
    .select({ code: sectors.code, nameAr: sectors.nameAr, nameEn: sectors.nameEn })
    .from(sectors)
    .where(eq(sectors.active, true))
    .orderBy(asc(sectors.sortOrder));
  return {
    services,
    sectors: sectorList,
    employeeBands: EMPLOYEE_BANDS,
    ownershipTypes: OWNERSHIP_TYPES,
    urgencies: URGENCIES,
    heardFrom: HEARD_FROM,
    privacyNoticeVersion: PRIVACY_NOTICE_VERSION,
  };
}
