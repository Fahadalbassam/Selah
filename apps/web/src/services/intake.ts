import "server-only";
import { createHmac } from "node:crypto";
import { asc, eq, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { sectors, serviceAreas } from "@/db/schema";
import { env } from "@/env";
import {
  CONTACT_CHANNELS,
  EMPLOYEE_BANDS,
  FAMILY_GENERATIONS,
  FAMILY_GOVERNANCE,
  FAMILY_WORKING,
  HEARD_FROM,
  OWNERSHIP_TYPES,
  PRIVACY_NOTICE_VERSION,
  REQUESTER_ROLES,
  URGENCIES,
} from "@/lib/intake";

// The public side of intake. The database does the real checks in
// submit_inquiry() (baseline: Intake); this module only shapes
// the request and keeps raw addresses out of the database.

export interface InquiryInput {
  orgName: string;
  orgNameAr?: string;
  sector: string;
  employeeBand?: (typeof EMPLOYEE_BANDS)[number];
  ownershipType?: (typeof OWNERSHIP_TYPES)[number];
  familyGeneration?: (typeof FAMILY_GENERATIONS)[number];
  familyWorking?: (typeof FAMILY_WORKING)[number];
  familyGovernance?: (typeof FAMILY_GOVERNANCE)[number];
  contactName: string;
  requesterRole: (typeof REQUESTER_ROLES)[number];
  contactRole?: string;
  email: string;
  phone?: string;
  contactChannel: (typeof CONTACT_CHANNELS)[number];
  preferredLanguage: "ar" | "en";
  services: string[];
  whyNow: string;
  message?: string;
  selfCheck: Partial<Record<"hasStrategy" | "hasOrgChart" | "hasDelegationMatrix" | "hasPolicies" | "hasSops" | "hasKpis", boolean>>;
  urgency?: (typeof URGENCIES)[number];
  heardFrom?: (typeof HEARD_FROM)[number];
  consent: true;
  marketingConsent: boolean;
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
    sector: input.sector,
    employee_band: input.employeeBand,
    ownership_type: input.ownershipType,
    family_generation: input.familyGeneration,
    family_working: input.familyWorking,
    family_governance: input.familyGovernance,
    contact_name: input.contactName,
    requester_role: input.requesterRole,
    contact_role: input.contactRole,
    email: input.email,
    phone: input.phone,
    contact_channel: input.contactChannel,
    preferred_language: input.preferredLanguage,
    services: input.services,
    why_now: input.whyNow,
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
    marketing_consent: input.marketingConsent,
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
