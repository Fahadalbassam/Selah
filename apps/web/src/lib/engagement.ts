// How a client takes part, and how the firm heard what it records for a
// consultant-managed client (baseline: Engagement).
export const ENGAGEMENT_MODES = ["full", "restricted", "consultant_managed"] as const;
export const RECEIVED_VIA = ["meeting", "email", "phone", "document"] as const;

export type ReceivedVia = (typeof RECEIVED_VIA)[number];

/** A client's short names, for masking: how many, and how long each (the database checks the same). */
export const SHORT_NAMES = { count: 6, min: 2, max: 100 } as const;

/** How the client told the firm, for work recorded on its behalf. */
export interface Received {
  receivedVia: ReceivedVia;
  /** YYYY-MM-DD, not in the future. */
  receivedOn: string;
}

/**
 * A client project the firm runs: the client has no accounts and the firm
 * records its work (consultant_managed). Its screens say so, and never ask
 * the client to sign in, send or read anything (page audit N24).
 */
export function firmRun(projectKind: string | null | undefined, engagementMode: string | null | undefined): boolean {
  return projectKind === "client" && engagementMode === "consultant_managed";
}

/**
 * What a progress note or a file sends about how and when the client sent
 * it: on a client the firm runs, the choice made in the dialog (a missing
 * one is left out, so the server says what is missing); anywhere else,
 * nothing, as the server takes none from anyone but the firm recording.
 */
export function receivedPayload(recordFor: boolean, via: ReceivedVia | "", on: string | undefined): Partial<Received> {
  if (!recordFor) return {};
  return { ...(via ? { receivedVia: via } : {}), ...(on ? { receivedOn: on } : {}) };
}

/**
 * Which wording an action's panels use: the client's own ("Client"), the
 * firm's working with a client that signs in ("Firm"), or the firm's on a
 * client it runs ("FirmRun"). Message keys end with it (hintClient, hintFirm, hintFirmRun).
 */
export function panelVoice(firmView: boolean, isFirmRun: boolean): "Client" | "Firm" | "FirmRun" {
  if (!firmView) return "Client";
  return isFirmRun ? "FirmRun" : "Firm";
}

/** Maps a data rule's message about modes and departments to a message key. */
export function engagementError(message: string | undefined): string | null {
  if (!message) return null;
  const rules: [RegExp, string][] = [
    [/switch off the client's accounts/, "accounts"],
    [/admin accounts only/, "nonAdmins"],
    [/at most \d+ admin accounts/, "tooMany"],
    [/minimal records are for clients the firm manages/, "minimal"],
    [/give the client an alias/, "alias"],
    [/remove the client's contacts and files/, "filed"],
    [/remove the names of people from the client's structure/, "structureNames"],
    [/department members are active people/, "member"],
    [/not in this department/, "notMember"],
    [/department is not active|not an active department/, "inactive"],
  ];
  return rules.find(([re]) => re.test(message))?.[1] ?? null;
}
