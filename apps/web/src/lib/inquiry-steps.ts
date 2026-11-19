// The inquiry page as numbered steps with one current step (page audit 5,
// batch 5, U16). Plain module: the page and the tests share it.
//
//   1 Read it and give it an owner · 2 Check for conflicts ·
//   3 Hold the discovery session · 4 Send the proposal · 5 Make it a client
//
// The steps are the ones the Inquiries list already names. The current step
// is the first one not done; only it gets a button, and only the reader's own
// permissions decide which (the server checks them again). Closing the
// inquiry is a quiet link under the steps, never a step. Nothing here changes
// what anyone may do.

export const INQUIRY_STEPS = ["triage", "conflict", "discovery", "proposal", "decide"] as const;
export type InquiryStep = (typeof INQUIRY_STEPS)[number];

export type StepState = "done" | "current" | "todo" | "problem";

/** The one button the current step offers, or null when it is someone else's move. */
export type StepMain =
  | "assign"
  | "triage"
  | "runSearch"
  | "recordConflict"
  | "bookDiscovery"
  | "recordDiscovery"
  | "proposalSent"
  | "convert"
  | null;

export interface InquiryFacts {
  status: string;
  hasOwner: boolean;
  conflictStatus: "not_checked" | "clear" | "flagged" | "waived";
  /** A conflict search has been run (clearing needs one). */
  searched: boolean;
  /** A discovery session is booked and not yet recorded. */
  sessionBooked: boolean;
  /** It became a client. */
  converted: boolean;
  can: { work: boolean; decide: boolean; forward: string | null; convert: boolean };
}

const CLOSED = ["lost", "declined", "spam", "withdrawn"];
const PAST_DISCOVERY = ["discovery_done", "proposal_sent", "won"];

export interface InquiryStepsView {
  steps: { key: InquiryStep; state: StepState }[];
  current: InquiryStep | null;
  main: StepMain;
  /** On the proposal step, the firm admin may also make it a client without a proposal: a quiet second way. */
  alsoConvert: boolean;
  closed: boolean;
}

export function inquirySteps(f: InquiryFacts): InquiryStepsView {
  const closed = CLOSED.includes(f.status);
  const won = f.converted || f.status === "won";
  const done: Record<InquiryStep, boolean> = {
    triage: f.status !== "new",
    conflict: f.conflictStatus === "clear" || f.conflictStatus === "waived",
    discovery: PAST_DISCOVERY.includes(f.status) || won,
    proposal: f.status === "proposal_sent" || won,
    decide: won,
  };
  // A won inquiry finished every step it needed, proposal or not.
  if (won) for (const k of INQUIRY_STEPS) done[k] = true;
  const current = closed || won ? null : (INQUIRY_STEPS.find((k) => !done[k]) ?? null);
  const steps = INQUIRY_STEPS.map((key) => ({
    key,
    state: (done[key]
      ? "done"
      : key === "conflict" && f.conflictStatus === "flagged"
        ? "problem"
        : key === current
          ? "current"
          : "todo") as StepState,
  }));
  return { steps, current, main: current ? mainFor(current, f) : null, alsoConvert: current === "proposal" && f.can.convert, closed };
}

function mainFor(step: InquiryStep, f: InquiryFacts): StepMain {
  switch (step) {
    case "triage":
      // The firm admin gives it an owner first; the owner (or the admin) then marks it read.
      if (!f.hasOwner && f.can.decide) return "assign";
      return f.can.forward === "triaged" ? "triage" : null;
    case "conflict":
      if (!f.can.decide) return null;
      return f.searched ? "recordConflict" : "runSearch";
    case "discovery":
      if (!f.can.work) return null;
      return f.sessionBooked ? "recordDiscovery" : "bookDiscovery";
    case "proposal":
      return f.can.forward === "proposal_sent" ? "proposalSent" : null;
    case "decide":
      return f.can.convert ? "convert" : null;
  }
}
