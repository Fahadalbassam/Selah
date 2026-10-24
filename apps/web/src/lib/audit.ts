// The audit-log screen's shared pieces (R2): how actions group into areas
// for the filter, the message key for an action's label, and CSV cells that
// a spreadsheet can't run as formulas. The database decides who reads what
// (app_audit_entries); nothing here is a permission.

/** Areas for the filter, by action prefix. An action is in an area when it is a prefix or starts with "prefix.". */
export const AUDIT_AREAS = {
  signIn: ["auth", "two_factor", "password", "invitation", "user"],
  files: ["document"],
  work: [
    "action",
    "actions",
    "action_note",
    "evidence",
    "evidence_request",
    "progress_update",
    "review",
    "deadline_request",
    "info_request",
    "risk",
    "follow_up",
    "finding",
    "recommendation",
  ],
  projects: [
    "project",
    "closure",
    "engagement",
    "client_role",
    "plan",
    "report",
    "meeting",
    "meeting_note",
    "assessment",
    "assessment_template",
    "template",
    "template_author",
    "department",
    "metrics",
    "team_metrics",
    "deviation",
    "activity",
    "schedule",
  ],
  people: ["membership", "org_user", "access_review", "client_assignment", "join_request", "consultant_profile", "client_contact"],
  clients: ["client", "organization", "client_profile", "client_report", "client_directory", "inquiry", "conflict", "lead_suggestion"],
  assistant: ["assistant", "ai_conversation"],
  settings: ["firm_settings", "audit_log"],
} as const satisfies Record<string, readonly string[]>;

export type AuditArea = keyof typeof AUDIT_AREAS;
export const AUDIT_OUTCOMES = ["allow", "deny", "error"] as const;
export type AuditOutcome = (typeof AUDIT_OUTCOMES)[number];

/** Rows per page on the screen, and the most one export holds. */
export const AUDIT_PAGE_SIZE = 50;
export const AUDIT_EXPORT_MAX = 20_000;

export function isAuditArea(v: unknown): v is AuditArea {
  return typeof v === "string" && Object.hasOwn(AUDIT_AREAS, v);
}

/** The area an action belongs to, or null. */
export function auditAreaOf(action: string): AuditArea | null {
  const prefix = action.split(".")[0]!;
  for (const [area, prefixes] of Object.entries(AUDIT_AREAS) as [AuditArea, readonly string[]][]) {
    if ((prefixes as readonly string[]).includes(prefix)) return area;
  }
  return null;
}

/** The message key under audit.actions (message keys can't hold dots). */
export const auditActionKey = (action: string) => action.replaceAll(".", "_");

/** One CSV cell: quoted, and text a spreadsheet would run as a formula starts with an apostrophe. */
export function csvCell(value: string | number | null | undefined): string {
  let s = value == null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replaceAll('"', '""')}"`;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The screen's filters from its URL; anything malformed is dropped rather than refused. */
export function auditFiltersFrom(q: Record<string, string | undefined>) {
  return {
    from: q.from && DAY.test(q.from) ? q.from : undefined,
    to: q.to && DAY.test(q.to) ? q.to : undefined,
    person: q.person && UUID.test(q.person) ? q.person : undefined,
    area: isAuditArea(q.area) ? q.area : undefined,
    outcome: (AUDIT_OUTCOMES as readonly string[]).includes(q.outcome ?? "") ? (q.outcome as AuditOutcome) : undefined,
    org: q.org && UUID.test(q.org) ? q.org : undefined,
  };
}
