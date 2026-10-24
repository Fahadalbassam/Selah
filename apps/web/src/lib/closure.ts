import { z } from "zod";

// Closing a project (baseline: Closing, 0020). Shared by the screens, the
// services and the tests; the database holds the same lists.

/** What happens to an action still open when its project closes (closure_disposition). */
export const DISPOSITIONS = ["handed_over", "deferred", "withdrawn", "waived"] as const;
export type Disposition = (typeof DISPOSITIONS)[number];

/** What app_closure_blockers() can report, in the order the screen lists them. */
export const BLOCKER_KINDS = ["action", "sustainer", "review", "deadline_request", "lessons"] as const;
export type BlockerKind = (typeof BLOCKER_KINDS)[number];

/** The tables a closed project freezes (the project_open trigger, check_project_open()). */
export const FROZEN_TABLES = [
  "action_notes",
  "actions",
  "assessment_answers",
  "assessment_evidence",
  "assessment_notes",
  "assessments",
  "deadline_change_requests",
  "document_shares",
  "documents",
  "engagement_deliverables",
  "evidence_requests",
  "evidence_submissions",
  "findings",
  "info_request_files",
  "info_requests",
  "kpis",
  "meeting_attendees",
  "meeting_decisions",
  "meeting_notes",
  "meeting_summaries",
  "meeting_summary_sources",
  "meeting_transcripts",
  "meetings",
  "progress_updates",
  "project_client_roles",
  "project_closure_items",
  "project_closure_lessons",
  "project_closure_requests",
  "project_members",
  "recommendation_kpis",
  "recommendation_responses",
  "recommendations",
  "reports",
  "reviews",
  "risk_acceptances",
  "strategic_objectives",
] as const;

/** Text limits the database enforces. */
export const CLOSURE_LIMITS = { note: 2000, reason: { min: 5, max: 2000 }, lessons: 4000, reply: { min: 3, max: 2000 } } as const;

/** A form's choice of who sustains a handed-over action: "user:<id>", "contact:<id>", or "later". */
export const SUSTAINER_CHOICE = z.string().regex(/^((user|contact):[0-9a-f-]{36}|later)$/);

export function parseSustainer(choice: string | undefined): { sustainerUserId: string | null; sustainerContactId: string | null } {
  const [kind, id] = (choice ?? "later").split(":");
  return { sustainerUserId: kind === "user" ? id! : null, sustainerContactId: kind === "contact" ? id! : null };
}
