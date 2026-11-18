// The home page per role (page audit 4.2, batch 2): what waits for the
// reader first, then how it is going. The rules that shape the lists live
// here, apart from the database reads (services/home.ts), so they are tested
// on their own.

import { actionsHref, LATE_HREF, REVIEWS_WAITING_LONG_HREF } from "@/lib/action-filters";

/** How many rows a section shows before "Show all" (page audit section 7, item 9). */
export const HOME_ROWS = 5;

/** The home's sections, as their anchors and their "Show all" key, in the order each role reads them. */
export const HOME_SECTIONS = [
  // Firm admin and consultants
  "decisions",
  "problems",
  "inquiries",
  "reviews",
  "due",
  "followUps",
  "meetings",
  "visits",
  // Client admin and client manager
  "answers",
  "documents",
  "sentBack",
  "late",
  "dates",
  "replies",
  "indicators",
  "deliverables",
  // Action owner
  "waiting",
  "withConsultant",
  "finished",
] as const;
export type HomeSection = (typeof HOME_SECTIONS)[number];

/** The section the reader asked to see in full (`?all=`), if it is one. */
export function openSection(param: string | string[] | undefined): HomeSection | null {
  const value = Array.isArray(param) ? param[0] : param;
  return (HOME_SECTIONS as readonly string[]).includes(value ?? "") ? (value as HomeSection) : null;
}

/** The first rows of a section, or all of them when it was opened. */
export function shown<T>(rows: readonly T[], open: boolean): T[] {
  return open ? [...rows] : rows.slice(0, HOME_ROWS);
}

/** Where "Show all" leads: the same home with that section in full, so the list it opens is the one the count is about. */
export function showAllHref(section: HomeSection): string {
  return `/?all=${section}#${section}`;
}

/**
 * Where each counter on the firm home leads: a filter of the Actions list
 * (page audit 4.6; decision D5, counts and never a health word), in the
 * Actions page's own addresses (lib/action-filters.ts).
 */
export const ACTIONS_FILTERS = {
  late: LATE_HREF,
  awaitingReview: actionsHref({ filter: "awaiting-review" }),
  reviewWaiting: REVIEWS_WAITING_LONG_HREF,
  blocked: actionsHref({ filter: "blocked" }),
} as const;
export type HomeCounter = keyof typeof ACTIONS_FILTERS;

/** The three groups of an action owner's home (page audit 4.2). */
export type OwnerGroup = "waiting" | "withConsultant" | "finished";

/** Which group an action of the owner's falls in; a draft is the firm's and in none. */
export function ownerGroup(status: string): OwnerGroup | null {
  switch (status) {
    case "assigned":
    case "in_progress":
    case "blocked":
    case "revision_requested":
      return "waiting";
    case "awaiting_review":
      return "withConsultant";
    case "verified_complete":
    case "closed":
      return "finished";
    default:
      return null;
  }
}

/**
 * The order of "waiting for me": sent back and late first, then the work in
 * progress (stopped work with it), then what has not started; by due date
 * inside each, undated last.
 */
export function waitingRank(row: { status: string; overdue: boolean }): number {
  if (row.status === "revision_requested" || row.overdue) return 0;
  if (row.status === "in_progress" || row.status === "blocked") return 1;
  return 2;
}

export function byWaiting<T extends { status: string; overdue: boolean; dueDate: string | null; id: string }>(rows: readonly T[]): T[] {
  return [...rows].sort(
    (a, b) =>
      waitingRank(a) - waitingRank(b) ||
      (a.dueDate ?? "9999-12-31").localeCompare(b.dueDate ?? "9999-12-31") ||
      a.id.localeCompare(b.id),
  );
}

/** What the row's link says: the step that waits on the action's page for its owner. */
export type NextStep = "start" | "sendForReview" | "resend" | "resume" | "open";

export function ownerNextStep(status: string): NextStep {
  switch (status) {
    case "assigned":
      return "start";
    case "in_progress":
      return "sendForReview";
    case "revision_requested":
      return "resend";
    case "blocked":
      return "resume";
    default:
      return "open";
  }
}
