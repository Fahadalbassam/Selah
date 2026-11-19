// The inquiry page as numbered steps with one current step (page audit 5,
// batch 5, U16). Plain module: the page and the tests share it.
//
//   1 Read it and give it an owner · 2 Hold the discovery session ·
//   3 Send the proposal · 4 Make it a client
//
// A wording batch changes no product rule (the lead's decision on review
// S3): the steps offer exactly the moves the server allows, as the page did
// before. The conflict check is a fact on the side with its own buttons, not
// a step that holds the others back; the server still asks for it before an
// inquiry becomes a client (can.convert). The current step is the first one
// not done; it has the one solid button, and any other move the server
// allows at this point is an outline button beside it. Closing the inquiry
// is a quiet button under the steps, never a step.

export const INQUIRY_STEPS = ["triage", "discovery", "proposal", "decide"] as const;
export type InquiryStep = (typeof INQUIRY_STEPS)[number];

export type StepState = "done" | "current" | "todo";

/** A button a step offers. */
export type StepMove = "assign" | "triage" | "bookDiscovery" | "recordDiscovery" | "proposalSent" | "convert";

export interface InquiryFacts {
  status: string;
  hasOwner: boolean;
  /** A discovery session is booked and not yet recorded. */
  sessionBooked: boolean;
  /** It became a client. */
  converted: boolean;
  /** From getInquiry(): work and decide are the permissions; forward the next status the owner may set; convert the server's own test. */
  can: { work: boolean; decide: boolean; forward: string | null; convert: boolean };
}

const CLOSED = ["lost", "declined", "spam", "withdrawn"];
const PAST_DISCOVERY = ["discovery_done", "proposal_sent", "won"];
/** Where the server lets a session be booked (services/inquiries.ts bookDiscovery). */
const BOOKABLE = ["new", "triaged", "discovery_scheduled"];

export interface InquiryStepsView {
  steps: { key: InquiryStep; state: StepState }[];
  current: InquiryStep | null;
  /** The current step's one solid button, or null when it is someone else's move. */
  main: StepMove | null;
  /** Other moves the server allows now, drawn as outline buttons in the current step. */
  also: StepMove[];
  closed: boolean;
}

export function inquirySteps(f: InquiryFacts): InquiryStepsView {
  const closed = CLOSED.includes(f.status);
  const won = f.converted || f.status === "won";
  const done: Record<InquiryStep, boolean> = {
    triage: f.status !== "new",
    discovery: PAST_DISCOVERY.includes(f.status),
    proposal: f.status === "proposal_sent",
    decide: false,
  };
  // A won inquiry finished every step it needed, proposal or not.
  if (won) for (const k of INQUIRY_STEPS) done[k] = true;
  const current = closed || won ? null : (INQUIRY_STEPS.find((k) => !done[k]) ?? null);
  const steps = INQUIRY_STEPS.map((key) => ({ key, state: (done[key] ? "done" : key === current ? "current" : "todo") as StepState }));
  if (!current) return { steps, current, main: null, also: [], closed };

  // Every move the server allows now, in the order the steps take them.
  const forward = (to: string) => f.can.work && f.can.forward === to;
  const allowed: StepMove[] = [];
  if (!f.hasOwner && f.can.decide && f.status === "new") allowed.push("assign");
  if (forward("triaged")) allowed.push("triage");
  if (f.can.work && BOOKABLE.includes(f.status)) allowed.push(f.sessionBooked ? "recordDiscovery" : "bookDiscovery");
  if (forward("proposal_sent")) allowed.push("proposalSent");
  if (f.can.convert) allowed.push("convert");

  const ofStep: Record<InquiryStep, StepMove[]> = {
    triage: ["assign", "triage"],
    discovery: ["bookDiscovery", "recordDiscovery"],
    proposal: ["proposalSent"],
    decide: ["convert"],
  };
  const main = ofStep[current].find((m) => allowed.includes(m)) ?? null;
  // Assigning an owner and marking it read are one step: the second waits for the first.
  const also = allowed.filter((m) => m !== main && !(main === "assign" && m === "triage"));
  return { steps, current, main, also, closed };
}
