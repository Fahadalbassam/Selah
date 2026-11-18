// The firm's Clients list (October review item 3): each client's team as the
// lead's name and "and N others", not a row of two-letter chips; pitches in a
// small table of their own.

export type ClientTeamLine = { kind: "lead"; lead: string; others: number } | { kind: "noLead"; others: number } | { kind: "nobody" };

/** The team column of one client: the lead by name, the other assigned consultants counted. */
export function clientTeamLine(input: { lead: string | null; others: string[] }): ClientTeamLine {
  if (input.lead) return { kind: "lead", lead: input.lead, others: input.others.length };
  return input.others.length ? { kind: "noLead", others: input.others.length } : { kind: "nobody" };
}

/** Prospects started as a pitch go to their own table; the order of each list is kept. */
export function splitPitches<T extends { prospect: boolean }>(list: readonly T[]): { clients: T[]; pitches: T[] } {
  return { clients: list.filter((c) => !c.prospect), pitches: list.filter((c) => c.prospect) };
}
