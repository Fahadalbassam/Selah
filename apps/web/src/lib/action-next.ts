import type { ActionStatus } from "@/authz/workflow";

// The action page's one card, "what waits, and on whom" (page audit 4.5,
// block 3; batch 4). One page for the owner, the manager and the reviewer;
// what differs is this card. Built only from what the server allows this
// reader (the moves canTransition() gives, the evidence and date rights), so
// it never offers a step the server would refuse, and never hides one the
// reader had: a step is the solid button, an outline beside it, a quiet link
// under it, or an item of the page's menu.
//
//   State          Owner or manager                Reviewer
//   Not started    Start work                      "With the client"
//   In progress    Send for review                 "With the client"
//   Sent back      Send the revised file (1 step)  "With the client"
//   Awaiting       "With the consultant since …"   Verify (or first / second sign-off), Send back
//   Date request   (a line above)                  Accept the new date, Decline
//   Stopped        Resume work, under the reason   "With the client"
//   Verified, closed: no card.

export type MainStep = "start" | "send" | "resend" | "resume" | "release" | "verify" | "signOff" | "secondSignOff" | "approveDate";
export type OutlineStep = "sendBack" | "resume" | "approveDate" | "declineDate";
/** Who the action is with, when the reader has nothing to press. */
export type Waiting = "withConsultant" | "withClient" | "withOwner" | "otherReviewer";
export type QuietLink = "stuck" | "moreTime" | "ask";
export type MenuItem = "close" | "reopen" | "acceptRisk" | "mute";

export interface NextInput {
  status: ActionStatus;
  /** The moves the server allows this reader now (canTransition). */
  moves: readonly ActionStatus[];
  /** May attach a file now (evidence.submit on an action open for evidence). */
  canSubmitEvidence: boolean;
  /** May propose a new date (no proposal waiting). */
  canRequestDate: boolean;
  /** May write in the conversation, so "Ask the consultant" has somewhere to go. */
  canAsk: boolean;
  /** A client admin or manager may sign that the company accepts the risk of not doing it. */
  canSignRisk: boolean;
  /** Receives mail about it, so may mute it. */
  canMute: boolean;
  /** The reader is firm staff. */
  firm?: boolean;
  /** Second sign-offs (F22): whether the work needs two, whether the first is in, what this reader may do. */
  second: { required: boolean; signed: boolean; canSignOff: boolean; canVerify: boolean } | null;
  /** A proposed date waits and this reader may decide it. */
  dateToDecide: boolean;
  /** Evidence items still to settle: with nothing sent yet (open or not accepted), and sent, to check. */
  items: { open: number; submitted: number };
}

export interface NextPlan {
  /** Draw the card at all (not on a verified or closed action). */
  card: boolean;
  /** The card's one solid button. */
  main: MainStep | null;
  /** Outline buttons beside it. */
  outline: OutlineStep[];
  /** What the card says when there is nothing to press. */
  waiting: Waiting | null;
  /** Waiting for review, and a second consultant checks it too (never the count). */
  secondChecks: boolean;
  /** Quiet links under the button: "I am stuck", "I need more time", "Ask the consultant". */
  links: QuietLink[];
  /** The page's ⋯ menu. */
  menu: MenuItem[];
  /**
   * October review, item 12: Verify also accepts the files still waiting to be
   * checked, in one step. Only when the reader verifies alone (no second
   * sign-off) and every item has its file: accepting an item is open to every
   * consultant who may verify, so this never changes who verifies, and with
   * two sign-offs the first reviewer's acceptance of the items is never skipped.
   */
  acceptsItems: boolean;
}

const FINISHED: readonly ActionStatus[] = ["verified_complete", "closed"];

export function nextStep(x: NextInput): NextPlan {
  const can = (to: ActionStatus) => x.moves.includes(to);
  const finished = FINISHED.includes(x.status);
  let main: MainStep | null = null;
  const outline: OutlineStep[] = [];

  if (x.status === "draft") {
    if (can("assigned")) main = "release";
  } else if (x.status === "assigned") {
    if (can("in_progress")) main = "start";
  } else if (x.status === "in_progress") {
    if (can("awaiting_review") || x.canSubmitEvidence) main = "send";
  } else if (x.status === "revision_requested") {
    // One step: the server moves it through "in progress" when the file is sent for review.
    if (x.canSubmitEvidence && can("in_progress")) main = "resend";
    // Review S2: "Resume work" beside it, never only a move the server could refuse.
    if (can("in_progress")) {
      if (main) outline.push("resume");
      else main = "resume";
    }
  } else if (x.status === "blocked") {
    if (can("in_progress")) main = "resume";
  } else if (x.status === "awaiting_review") {
    if (x.second?.required) {
      if (x.second.canSignOff) main = "signOff";
      else if (x.second.signed && x.second.canVerify) main = "secondSignOff";
    } else if (can("verified_complete")) {
      main = "verify";
    }
    if (main && can("revision_requested")) outline.push("sendBack");
  }

  if (!finished && x.dateToDecide) {
    if (main) outline.push("approveDate", "declineDate");
    else {
      main = "approveDate";
      outline.push("declineDate");
    }
  }

  // The work side: the reader moves the work itself (an owner, a manager, the firm recording for a client it runs).
  const works = x.moves.some((m) => m === "in_progress" || m === "blocked" || m === "awaiting_review") || x.canSubmitEvidence;
  let waiting: Waiting | null = null;
  if (!finished && !main && x.status !== "draft") {
    if (x.status === "awaiting_review") waiting = x.firm ? "otherReviewer" : "withConsultant";
    else if (!works) waiting = x.firm ? "withClient" : "withOwner";
  }

  const links: QuietLink[] = [];
  if (!finished && x.status !== "draft") {
    if (can("blocked")) links.push("stuck");
    if (x.canRequestDate) links.push("moreTime");
    if (x.canAsk) links.push("ask");
  }

  const menu: MenuItem[] = [];
  if (can("closed")) menu.push("close");
  if (finished && can("in_progress")) menu.push("reopen");
  if (x.canSignRisk && !finished) menu.push("acceptRisk");
  if (x.canMute) menu.push("mute");

  return {
    card: !finished,
    main,
    outline,
    waiting,
    secondChecks: x.status === "awaiting_review" && !!x.second?.required,
    links,
    menu,
    acceptsItems: main === "verify" && !x.second?.required && x.items.open === 0 && x.items.submitted > 0,
  };
}
