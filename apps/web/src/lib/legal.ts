// The documents behind Selah's first sign-in (R1) and the ones published for
// clients' legal and IT teams. Accepted documents carry a version: the date
// their text last changed. The database holds the same dates
// (app_legal_version(), tests/db/rule-parity.test.ts compares them), and a
// person is asked again when one changes.

/** Accepted at the first sign-in, each recorded on its own. */
export const ACCEPTED_DOCS = ["terms", "privacy", "ai_notice"] as const;
export type AcceptedDoc = (typeof ACCEPTED_DOCS)[number];

export const LEGAL_VERSIONS: Record<AcceptedDoc, string> = {
  terms: "2026-10-24",
  privacy: "2026-10-24",
  ai_notice: "2026-10-24",
};

/** Published for reading only: the data agreement template, the sub-processor list and the security overview (R5). */
export const REFERENCE_DOCS = ["data_agreement", "subprocessors", "security"] as const;
export type ReferenceDoc = (typeof REFERENCE_DOCS)[number];

export type LegalDoc = AcceptedDoc | ReferenceDoc;
export const LEGAL_DOCS: readonly LegalDoc[] = [...ACCEPTED_DOCS, ...REFERENCE_DOCS];

/** The public address of each document: /legal/<slug>. */
export const LEGAL_SLUGS: Record<LegalDoc, string> = {
  terms: "terms",
  privacy: "privacy",
  ai_notice: "ai",
  data_agreement: "data-agreement",
  subprocessors: "sub-processors",
  security: "security",
};

export function legalDocFromSlug(slug: string): LegalDoc | null {
  return (Object.entries(LEGAL_SLUGS).find(([, s]) => s === slug)?.[0] as LegalDoc | undefined) ?? null;
}

/** Which way traffic comes in (R5): COMPOSE_PROFILES, passed to the app as SELAH_EDGE. */
export function edgeMode(value: string | undefined): "direct" | "tunnel" | null {
  const profiles = (value ?? "").split(",").map((p) => p.trim());
  if (profiles.includes("direct")) return "direct";
  if (profiles.includes("tunnel")) return "tunnel";
  return null;
}
