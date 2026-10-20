import type { Principal, Resource, Role } from "@/authz";

// Two client tenants (Acme, Beta) served by one firm org.
export const FIRM = "00000000-0000-4000-8000-00000000000a";
export const ACME = "00000000-0000-4000-8000-0000000000a1";
export const BETA = "00000000-0000-4000-8000-0000000000b1";
export const ACME_ENG_1 = "00000000-0000-4000-8000-0000000000e1";
export const ACME_ENG_2 = "00000000-0000-4000-8000-0000000000e2";
export const BETA_ENG = "00000000-0000-4000-8000-0000000000e3";

let n = 0;
export function principal(role: Role, engagements: string[] = [], orgId?: string): Principal {
  const firm = role === "firm_lead" || role === "consultant";
  return {
    userId: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
    orgId: orgId ?? (firm ? FIRM : ACME),
    orgKind: firm ? "firm" : "client",
    role,
    engagementIds: new Set(engagements),
  };
}

export function acmeRecord(type: Resource["type"], extra: Partial<Resource> = {}): Resource {
  return { type, clientOrgId: ACME, firmOrgId: FIRM, engagementId: ACME_ENG_1, ...extra };
}

export function betaRecord(type: Resource["type"], extra: Partial<Resource> = {}): Resource {
  return { type, clientOrgId: BETA, firmOrgId: FIRM, engagementId: BETA_ENG, ...extra };
}
