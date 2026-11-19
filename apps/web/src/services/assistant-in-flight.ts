import "server-only";

/**
 * How many answers one person may have on their way at once. The model runs
 * one answer at a time for everyone (OLLAMA_NUM_PARALLEL=1, docs/assistant.md,
 * "Streaming"), and on a processor each takes minutes, so one person asking
 * over and over would hold the queue for everyone else. Firm staff may have a
 * second chat going; a client person one. Counted per web process (Selah runs
 * one), from before the search until the answer is saved, also when the
 * person closed the card meanwhile (the answer is still written for them).
 */
export const ANSWERS_AT_ONCE = { firm: 2, client: 1 } as const;

const inFlight = new Map<string, number>();

/** A slot for one more answer, or null when the person already has as many as they may; the release is safe to call twice. */
export function takeAnswerSlot(userId: string, orgKind: "firm" | "client"): (() => void) | null {
  const now = inFlight.get(userId) ?? 0;
  if (now >= ANSWERS_AT_ONCE[orgKind]) return null;
  inFlight.set(userId, now + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const left = (inFlight.get(userId) ?? 1) - 1;
    if (left > 0) inFlight.set(userId, left);
    else inFlight.delete(userId);
  };
}
