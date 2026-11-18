// The project's Progress tab, by reader (page audit U11, batch 1). The firm
// reads every working measure; a client reader reads the plain part: the
// share verified, how the actions ended and the reports the firm shared with
// them. The handover card (date, sponsor, the firm's check-ins) is the firm's.

export function progressParts(firm: boolean) {
  return {
    /** The share verified, with "X of Y actions that still apply". */
    implemented: true,
    /** Verified, partly done, risk accepted, no longer applies, replaced, still open. */
    outcomes: true,
    /** The reports: all of them for the firm, the shared ones for a client. */
    reports: true,
    /** Waiting for review (with the median wait), overdue, blocked, no activity, verified on time, date moves, reviews asking for changes, what verification rests on. */
    measures: firm,
    /** Open actions by how long they are past the date agreed at release. */
    lateAgainstOriginal: firm,
    /** The monthly snapshots drawn as a trend. */
    history: firm,
    /** The handover date, the client's sponsor and the firm's check-ins after it. */
    handover: firm,
  };
}
