// A client leaving (baseline: Offboarding, 0024). Shared by the screens, the
// services and the tests; the database holds the same numbers and lists.

/** Days the client's people keep read-only access after archiving. */
export const GRACE_DAYS = { min: 0, max: 90, default: 60 } as const;

/**
 * Years a client's records are kept after it is archived before the purge
 * job deletes them: Saudi law on commercial books (ten years for books and
 * correspondence) and the CMA corporate governance regulations (ten years
 * for minutes and documents).
 */
export const RETENTION_YEARS = 10;

/** Text limits the database enforces. */
export const OFFBOARDING_LIMITS = { note: 2000, reason: { min: 5, max: 2000 } } as const;

/** Client-level tables an archived client freezes (the client_open trigger, check_client_open()). */
export const CLIENT_FROZEN_TABLES = [
  "client_contacts",
  "client_profiles",
  "departments",
  "engagements",
  "invitations",
  "join_requests",
  "projects",
] as const;

/** What the purge job counts in a deletion record (client_deletions.counts). */
export const DELETION_COUNTS = ["projects", "actions", "documents", "people", "contacts"] as const;
