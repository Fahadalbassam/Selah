import { OPEN_STATUSES, type ActionStatus } from "@/authz/workflow";
import type { LadderAudience } from "@/lib/mail-choices";

// The action page for a client reader (page audit 4.5, batch 1). The firm's
// machinery is not drawn there: no reminder ladder, no date history, no
// sign-off count. Two plain lines take their place: what is expected next and
// by when, and what happened last to the date. The server rules do not
// change; this only decides what the client's page says.

/** Which of the firm's cards the action page draws for this reader. */
export function actionPageCards(firmView: boolean) {
  return {
    /** The reminder ladder (who is told, step by step). */
    ladder: firmView,
    /** The due-date card with every move of the date, the slip sentence and "asked after the due date". */
    dateHistory: firmView,
    /** "One of two sign-offs done" under the next step, and the second sign-off card. */
    signOffs: firmView,
    /** Risk acceptance as its own card with a button on every open action; a client finds it in the page menu. */
    riskCard: firmView,
    /** Mute mail as a header button; a client finds it in the page menu. */
    muteButton: firmView,
  };
}

export interface LadderStepLike {
  level: number;
  onDate: string;
  audience: readonly LadderAudience[];
  sentAt: Date | null;
}

export interface DateRequestLike {
  status: "pending" | "approved" | "rejected";
  proposedDueDate: string;
  requestedBy: string | null;
  requestedById?: string | null;
  decidedBy?: string | null;
  decidedAt?: Date | string | null;
  createdAt: Date | string;
}

export interface DateMoveLike {
  to: string | null;
  by: string | null;
  viaRequest: boolean;
  at: Date | string;
}

/** Who a step reaches, in the client's words: the owner is "the reminder"; everyone else is named. */
export type PlainWho = "managers" | "department_head" | "lead_consultant" | "project_lead" | "sponsor" | "admins" | "firm";

const WHO: Record<LadderAudience, PlainWho | null> = {
  owner: null,
  client_managers: "managers",
  department_head: "department_head",
  client_admins_for_head: "admins",
  client_lead: "lead_consultant",
  project_lead: "project_lead",
  sponsor: "sponsor",
  client_admins: "admins",
  watching_firm_admins: "firm",
};

/** What is expected next, and by when. */
export type NextLine =
  | { kind: "due"; due: string; reminderOn: string | null; tellOn: string | null; who: PlainWho[] }
  | { kind: "late"; due: string; tellOn: string | null; who: PlainWho[] };

/** What happened last to the date. */
export type LastLine =
  | { kind: "proposed"; date: string; by: string | null; mine: boolean }
  | { kind: "moved"; date: string; by: string | null; agreed: boolean; at: Date | string }
  | { kind: "declined"; date: string; by: string | null; at: Date | string };

const time = (d: Date | string) => new Date(d).getTime();

/**
 * The two plain lines for a client reader. `next` is null on an action that
 * is finished, still a draft, with the consultant for review (nothing is
 * expected of the client then) or without a due date; `last` is null until
 * the date was proposed, moved or a proposal declined, and on finished work
 * (its date no longer matters).
 */
export function plainDateLines(input: {
  status: ActionStatus;
  dueDate: string | null;
  overdue: boolean;
  ladder: { running: boolean; steps: readonly LadderStepLike[] };
  requests: readonly DateRequestLike[];
  moves: readonly DateMoveLike[];
  readerId: string;
}): { next: NextLine | null; last: LastLine | null } {
  const open = (OPEN_STATUSES as readonly string[]).includes(input.status);
  return { next: nextLine(input), last: open ? lastLine(input) : null };
}

function nextLine(input: {
  status: ActionStatus;
  dueDate: string | null;
  overdue: boolean;
  ladder: { running: boolean; steps: readonly LadderStepLike[] };
}): NextLine | null {
  const open = (OPEN_STATUSES as readonly string[]).includes(input.status);
  if (!open || input.status === "awaiting_review" || !input.dueDate) return null;
  // The next step that has not gone out, while reminders run (they pause while the firm has the action).
  const step = input.ladder.running ? input.ladder.steps.find((s) => !s.sentAt) ?? null : null;
  const who = step ? [...new Set(step.audience.map((a) => WHO[a]).filter((w): w is PlainWho => w !== null))] : [];
  if (input.overdue) return { kind: "late", due: input.dueDate, tellOn: step && who.length ? step.onDate : null, who: step ? who : [] };
  return {
    kind: "due",
    due: input.dueDate,
    // A step that reaches only the owner is a reminder; one that reaches others says who is told.
    reminderOn: step && !who.length ? step.onDate : null,
    tellOn: step && who.length ? step.onDate : null,
    who,
  };
}

function lastLine(input: { requests: readonly DateRequestLike[]; moves: readonly DateMoveLike[]; readerId: string }): LastLine | null {
  // A proposal still waiting is what the reader needs to know first.
  const pending = input.requests.find((r) => r.status === "pending");
  if (pending)
    return { kind: "proposed", date: pending.proposedDueDate, by: pending.requestedBy, mine: !!pending.requestedById && pending.requestedById === input.readerId };
  const move = [...input.moves].sort((a, b) => time(b.at) - time(a.at))[0];
  const declined = input.requests
    .filter((r) => r.status === "rejected" && r.decidedAt)
    .sort((a, b) => time(b.decidedAt!) - time(a.decidedAt!))[0];
  if (declined && (!move || time(declined.decidedAt!) > time(move.at)))
    return { kind: "declined", date: declined.proposedDueDate, by: declined.decidedBy ?? null, at: declined.decidedAt! };
  if (move && move.to) return { kind: "moved", date: move.to, by: move.by, agreed: move.viaRequest, at: move.at };
  return null;
}
