// The six visible status words (decision D3; page audit 4.7; docs/placement.md).
// Plain module: badges, lists, the detail pages and the tests share it.
//
//   Not started · In progress · Waiting for the firm / the client ·
//   Needs attention · Verified · Closed
//
// Lists, homes and badges show the word. The detail page shows the word and,
// beside it, the exact stored state when the word does not already say it
// ("Waiting for you", then "Sent back"). Nothing here changes a stored state
// or a rule: it only decides which word a state is drawn with.
//
// "Waiting for" names who must move next, never who is late. The reader's own
// side reads "you" («بانتظاركم»); the firm reads "Waiting for the client".
// Verified («تم التحقق») is the consultant's check of an action only, and the
// only green; a part (an evidence item, a document request) is "Accepted".

import type { Tone } from "@/components/tone-badge";

export const STATUS_WORDS = ["not_started", "in_progress", "waiting", "needs_attention", "verified", "closed"] as const;
export type StatusWord = (typeof STATUS_WORDS)[number];

/** Whose move it is, for "waiting": the firm, the client, or whoever reads it (a meeting invitation). */
export type WaitingOn = "firm" | "client" | "reader";
/** Which side reads the screen. */
export type Reader = "firm" | "client";

/**
 * A part's own label at its level, inside one of the six words: an evidence
 * item or a document request is "Accepted" (not "Verified"), "Not needed" or
 * "Not applicable"; a meeting "Held" or "Cancelled"; a pitch is "Pitch".
 */
export type ItemLabel = "accepted" | "notNeeded" | "notApplicable" | "held" | "cancelled" | "pitch" | "draft";

export interface Placement {
  word: StatusWord;
  /** Only for "waiting". */
  on?: WaitingOn;
  /** The part's own label, when the placement table gives one. */
  item?: ItemLabel;
}

// ---- Every kind of thing, every stored state (docs/placement.md) ----

export const ACTION_STATES = [
  "draft",
  "assigned",
  "in_progress",
  "blocked",
  "awaiting_review",
  "revision_requested",
  "verified_complete",
  "closed",
] as const;
export type ActionState = (typeof ACTION_STATES)[number];

const ACTION: Record<ActionState, Placement> = {
  // Firm only (D6): the page itself says "Draft".
  draft: { word: "not_started" },
  assigned: { word: "not_started" },
  in_progress: { word: "in_progress" },
  blocked: { word: "needs_attention" },
  awaiting_review: { word: "waiting", on: "firm" },
  revision_requested: { word: "waiting", on: "client" },
  verified_complete: { word: "verified" },
  closed: { word: "closed" },
};

export const EVIDENCE_ITEM_STATES = ["open", "submitted", "accepted", "rejected", "waived"] as const;
export type EvidenceItemState = (typeof EVIDENCE_ITEM_STATES)[number];

const EVIDENCE_ITEM: Record<EvidenceItemState, Placement> = {
  open: { word: "waiting", on: "client" },
  submitted: { word: "waiting", on: "firm" },
  // Not accepted: back with the client, the reason under the row.
  rejected: { word: "waiting", on: "client" },
  accepted: { word: "verified", item: "accepted" },
  waived: { word: "closed", item: "notNeeded" },
};

export const INFO_REQUEST_STATES = ["requested", "received", "reviewed", "not_applicable"] as const;
export type InfoRequestState = (typeof INFO_REQUEST_STATES)[number];

const INFO_REQUEST: Record<InfoRequestState, Placement> = {
  // A returned request is "requested" again, the reason under the row.
  requested: { word: "waiting", on: "client" },
  received: { word: "waiting", on: "firm" },
  // The stored word for the firm's yes is "reviewed"; on screen it is Accept / Accepted.
  reviewed: { word: "verified", item: "accepted" },
  not_applicable: { word: "closed", item: "notApplicable" },
};

export const DATE_REQUEST_STATES = ["pending", "approved", "rejected"] as const;
export type DateRequestState = (typeof DATE_REQUEST_STATES)[number];

const DATE_REQUEST: Record<DateRequestState, Placement> = {
  pending: { word: "waiting", on: "firm" },
  approved: { word: "verified", item: "accepted" },
  rejected: { word: "closed" },
};

export const MEETING_STATES = ["scheduled", "held", "cancelled"] as const;
export type MeetingState = (typeof MEETING_STATES)[number];

export const INQUIRY_STATES = [
  "new",
  "triaged",
  "discovery_scheduled",
  "discovery_done",
  "proposal_sent",
  "won",
  "lost",
  "declined",
  "spam",
  "withdrawn",
] as const;
export type InquiryState = (typeof INQUIRY_STATES)[number];

const INQUIRY: Record<InquiryState, Placement> = {
  new: { word: "waiting", on: "firm" },
  triaged: { word: "in_progress" },
  discovery_scheduled: { word: "in_progress" },
  // The prospect's move: the firm waits for their answer.
  discovery_done: { word: "waiting", on: "client" },
  proposal_sent: { word: "waiting", on: "client" },
  won: { word: "closed" },
  lost: { word: "closed" },
  declined: { word: "closed" },
  spam: { word: "closed" },
  withdrawn: { word: "closed" },
};

export const PROJECT_STATES = ["draft", "planned", "active", "closing", "closed"] as const;
export type ProjectState = (typeof PROJECT_STATES)[number];

const PROJECT: Record<ProjectState, Placement> = {
  // A client project no signed engagement covers yet: the firm's pitch.
  draft: { word: "not_started", item: "pitch" },
  planned: { word: "not_started" },
  active: { word: "in_progress" },
  closing: { word: "in_progress" },
  closed: { word: "closed" },
};

export const CLOSE_REQUEST_STATES = ["pending", "accepted", "declined"] as const;
export type CloseRequestState = (typeof CLOSE_REQUEST_STATES)[number];

const CLOSE_REQUEST: Record<CloseRequestState, Placement> = {
  pending: { word: "waiting", on: "firm" },
  accepted: { word: "closed" },
  declined: { word: "closed" },
};

export const actionPlacement = (s: ActionState): Placement => ACTION[s];
export const evidenceItemPlacement = (s: EvidenceItemState): Placement => EVIDENCE_ITEM[s];
export const infoRequestPlacement = (s: InfoRequestState): Placement => INFO_REQUEST[s];
export const dateRequestPlacement = (s: DateRequestState): Placement => DATE_REQUEST[s];
export const inquiryPlacement = (s: InquiryState): Placement => INQUIRY[s];
export const projectPlacement = (s: ProjectState): Placement => PROJECT[s];
export const closeRequestPlacement = (s: CloseRequestState): Placement => CLOSE_REQUEST[s];

/**
 * A meeting: before it, an invitation the reader has not answered waits for
 * them; an answered one has not started. Held and cancelled are closed at
 * their level (the follow-ups carry their own state).
 */
export function meetingPlacement(s: MeetingState, unanswered = false): Placement {
  if (s === "held") return { word: "closed", item: "held" };
  if (s === "cancelled") return { word: "closed", item: "cancelled" };
  return unanswered ? { word: "waiting", on: "reader" } : { word: "not_started" };
}

/** The tables, for the tests and docs/placement.md. */
export const PLACEMENTS = {
  action: ACTION,
  evidenceItem: EVIDENCE_ITEM,
  infoRequest: INFO_REQUEST,
  dateRequest: DATE_REQUEST,
  inquiry: INQUIRY,
  project: PROJECT,
  closeRequest: CLOSE_REQUEST,
} as const;

// ---- Words on screen ----

/** Message keys under `statusWords` (messages/ar.json, en.json). */
export type StatusWordKey =
  | "notStarted"
  | "inProgress"
  | "waitingFirm"
  | "waitingClient"
  | "waitingYou"
  | "needsAttention"
  | "verified"
  | "closed";

/** The word's message key, for this reader: "Waiting for you" on the reader's own side. */
export function wordKey(p: Placement, reader: Reader): StatusWordKey {
  switch (p.word) {
    case "not_started":
      return "notStarted";
    case "in_progress":
      return "inProgress";
    case "needs_attention":
      return "needsAttention";
    case "verified":
      return "verified";
    case "closed":
      return "closed";
    case "waiting": {
      // The placement table: the firm reads "Waiting for the firm" for its own move too.
      if (p.on === "reader") return "waitingYou";
      if (p.on === "client") return reader === "client" ? "waitingYou" : "waitingClient";
      return "waitingFirm";
    }
  }
}

/**
 * The label a badge draws: the part's own label where the table gives one
 * (`statusWords.items.*`), otherwise the word (`statusWords.*`).
 */
export function labelKey(p: Placement, reader: Reader): `items.${ItemLabel}` | StatusWordKey {
  return p.item ? `items.${p.item}` : wordKey(p, reader);
}

/**
 * The colour of each word (docs/ui-guidelines.md 5.3). Green only for an
 * action a consultant verified: a part's "Accepted" stays grey, like closed.
 */
export function placementTone(p: Placement): Tone {
  if (p.item === "pitch" || p.item === "draft") return "neutral";
  if (p.item) return p.word === "waiting" ? "waiting" : "neutral";
  switch (p.word) {
    case "not_started":
      return "open";
    case "in_progress":
      return "active";
    case "waiting":
      return "waiting";
    case "needs_attention":
      return "problem";
    case "verified":
      return "verified";
    case "closed":
      return "neutral";
  }
}

/**
 * Whether the detail page prints the exact stored state beside the word: only
 * when the word does not already say it (In progress, Verified and Closed do;
 * a closed action adds its outcome instead).
 */
export function actionExactShown(state: ActionState): boolean {
  return !["in_progress", "verified_complete", "closed"].includes(state);
}
