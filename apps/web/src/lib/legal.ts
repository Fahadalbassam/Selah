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

/**
 * Where mail goes (R5), read from SMTP_URL, the relay the mail sender uses:
 * - "outside": a mail service on the internet, so the sub-processor list
 *   marks its mail row "in use on this site";
 * - "local": a mailbox on this machine or this server's own network (the
 *   test stack's Mailpit, a relay on a private address), which is no outside
 *   service;
 * - "none": no relay, so mails are printed, not sent (development only).
 *
 * Only the host is read, never the credentials in the address. When in
 * doubt it answers "outside": the list may say a service is in use that is
 * not, never the other way round. In production the sender refuses to start
 * without a relay, so a missing setting there means this process was not
 * told, not that no mail leaves.
 */
export function mailRelay(smtpUrl: string | undefined, production: boolean): "outside" | "local" | "none" {
  const value = (smtpUrl ?? "").trim();
  if (!value) return production ? "outside" : "none";
  let host: string;
  try {
    host = new URL(value).hostname.toLowerCase().replace(/^\[|\]$/g, "");
  } catch {
    return "outside";
  }
  if (!host) return "outside";
  // IPv6: only loopback counts as local.
  if (host.includes(":")) return host === "::1" ? "local" : "outside";
  // IPv4: loopback and the private ranges.
  const ip = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(host);
  if (ip) {
    const [a, b] = [Number(ip[1]), Number(ip[2])];
    return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) ? "local" : "outside";
  }
  // A bare name is another container or machine on this network (such as "mailpit").
  if (!host.includes(".")) return "local";
  return /(^|\.)localhost$|\.(local|test|internal|lan)$/.test(host) ? "local" : "outside";
}

/** The rows of the sub-processor list (R5). */
export const SUBPROCESSOR_ROWS = ["edge", "mail", "llm"] as const;
export type SubprocessorRow = (typeof SUBPROCESSOR_ROWS)[number];

/**
 * Which outside services this site uses now, each read from the setting that
 * decides it: the way in, the mail relay and where the AI model runs. None
 * is assumed.
 */
export function subprocessorsInUse(settings: {
  SELAH_EDGE?: string;
  SMTP_URL?: string;
  LLM_PROVIDER: string;
  NODE_ENV: string;
}): Record<SubprocessorRow, boolean> {
  return {
    edge: edgeMode(settings.SELAH_EDGE) === "tunnel",
    mail: mailRelay(settings.SMTP_URL, settings.NODE_ENV === "production") === "outside",
    llm: settings.LLM_PROVIDER !== "ollama",
  };
}

/**
 * The legal texts name other pages by their address ("/legal/sub-processors",
 * "/privacy"). Splits a text into plain pieces and those addresses, so the
 * page can show each as a link set left to right; the words stay as written.
 * Only addresses of pages that exist are picked out.
 */
export function splitPageAddresses(text: string): { text: string; href?: string }[] {
  const parts: { text: string; href?: string }[] = [];
  let last = 0;
  for (const m of text.matchAll(/\/legal\/([a-z-]+)|\/privacy(?![\w/-])/g)) {
    // A sentence's hyphen or full stop is never part of the address.
    const address = m[0].replace(/-+$/, "");
    if (m[1] !== undefined && !legalDocFromSlug(address.slice("/legal/".length))) continue;
    if (m.index > last) parts.push({ text: text.slice(last, m.index) });
    parts.push({ text: address, href: address });
    last = m.index + address.length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}
