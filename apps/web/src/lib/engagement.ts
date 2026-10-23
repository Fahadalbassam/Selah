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
    [/department members are active people/, "member"],
    [/not in this department/, "notMember"],
    [/department is not active|not an active department/, "inactive"],
  ];
  return rules.find(([re]) => re.test(message))?.[1] ?? null;
}
