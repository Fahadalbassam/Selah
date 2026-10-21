// How a client takes part, and how the firm heard what it records for a
// consultant-managed client (drizzle/0025_engagement_rules.sql).
export const ENGAGEMENT_MODES = ["full", "restricted", "consultant_managed"] as const;
export const RECEIVED_VIA = ["meeting", "email", "phone", "document"] as const;

export type ReceivedVia = (typeof RECEIVED_VIA)[number];

/** How the client told the firm, for work recorded on its behalf. */
export interface Received {
  receivedVia: ReceivedVia;
  /** YYYY-MM-DD, not in the future. */
  receivedOn: string;
}
