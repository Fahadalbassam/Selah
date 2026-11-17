// Who sees an item (decision of 17 Nov 2026, feature A): "everyone with
// access, except…" or "only these people…". The picker can only take people
// away; it never gives anyone access the other rules do not already give.
// These are the rules the picker and (next) the server share. Pure: no React,
// no database.

/** "everyone" is the default and is saved as no audience at all. */
export const AUDIENCE_MODES = ["everyone", "except", "only"] as const;
export type AudienceMode = (typeof AUDIENCE_MODES)[number];

/** The two positions of the switch; "everyone" is "except" with nobody left out. */
export type AudienceSwitch = Exclude<AudienceMode, "everyone">;

/** What the picker is on: documents (every kind except evidence) and meetings. */
export type AudienceItemKind = "document" | "meeting";

/** Which side a person or an item belongs to. */
export type AudienceSide = "firm" | "client";

/**
 * Why a person can never be taken off an item: they stay so the work cannot
 * stall. Shown as a locked chip with this reason.
 */
export const AUDIENCE_LOCK_REASONS = [
  "self",
  "uploader",
  "clientAdmin",
  "firmAdmin",
  "lead",
  "deputy",
  "organiser",
  "requiredAttendee",
] as const;
export type AudienceLockReason = (typeof AUDIENCE_LOCK_REASONS)[number];

/** Someone who can already see the item, as the server lists them. */
export interface AudiencePerson {
  id: string;
  name: { ar: string; en: string };
  side: AudienceSide;
  /** Set when this person can never be left out. */
  locked?: AudienceLockReason;
  /** Shown under the name and searched too: an email, a job title. */
  hint?: string;
}

/** A heading of the picker's list and the people under it. */
export interface AudienceGroup {
  side: AudienceSide;
  /** The heading: Firm, Client, or, on the client's own item, Your company. */
  label: "firm" | "client" | "yourCompany";
  items: AudiencePerson[];
}

/**
 * The people the picker offers, grouped Firm then Client, each in the
 * server's order, with empty groups left out. On a client's own item the
 * client takes off only its own people (the firm's team always sees it), so
 * only they are offered, under "Your company": the reader is the client.
 */
export function audienceGroups(people: readonly AudiencePerson[], owner: AudienceSide = "firm"): AudienceGroup[] {
  const sides: AudienceSide[] = owner === "client" ? ["client"] : ["firm", "client"];
  return sides
    .map((side) => ({
      side,
      label: side === "firm" ? ("firm" as const) : owner === "client" ? ("yourCompany" as const) : ("client" as const),
      items: people.filter((p) => p.side === side),
    }))
    .filter((group) => group.items.length > 0);
}

/** What gets stored: nothing (everyone with access), or a mode and its people. */
export type SavedAudience = null | { mode: AudienceSwitch; people: string[] };

export type AudienceCheck = { ok: true; value: SavedAudience } | { ok: false; error: "onlyEmpty" };

const unique = (ids: readonly string[]) => [...new Set(ids)];

/**
 * The picks as they should stand in a mode. Leaving out: locked people are
 * never on the list. Only: locked people are always on it, first.
 */
export function audienceSelection(mode: AudienceMode, selected: readonly string[], locked: readonly string[]): string[] {
  if (mode === "everyone") return [];
  if (mode === "except") {
    const keep = new Set(locked);
    return unique(selected).filter((id) => !keep.has(id));
  }
  return unique([...locked, ...selected]);
}

/**
 * The value to save for (mode, picks, locked people), or why it cannot be
 * saved. Locked people count on an "only" list: they are chips and they do
 * see the item, so "only" is refused only when nobody at all is on it. A
 * "leave out" list with nobody on it is the same as everyone with access.
 */
export function audienceToSave(mode: AudienceMode, selected: readonly string[], locked: readonly string[]): AudienceCheck {
  const people = audienceSelection(mode, selected, locked);
  if (mode === "only") return people.length > 0 ? { ok: true, value: { mode: "only", people } } : { ok: false, error: "onlyEmpty" };
  return { ok: true, value: people.length > 0 ? { mode: "except", people } : null };
}

/** The mode the picks describe: leaving out nobody is everyone with access. */
export function audienceMode(position: AudienceSwitch, selected: readonly string[], locked: readonly string[]): AudienceMode {
  if (position === "only") return "only";
  return audienceSelection("except", selected, locked).length > 0 ? "except" : "everyone";
}

/**
 * The picks once the form changed who can see the item (its label, its
 * department, who is invited): a pick no longer offered is dropped, and so is
 * someone on a list of people left out who now always sees it (a required
 * attendee, say). Locked people stay on an "only" list, since they see it
 * anyway. `dropped` says who, for one plain line on the form.
 */
export function reconcileAudience(
  mode: AudienceMode,
  selected: readonly string[],
  people: readonly AudiencePerson[],
): { selected: string[]; dropped: string[] } {
  const byId = new Map(people.map((p) => [p.id, p]));
  const keep = (id: string) => byId.has(id) && !(mode === "except" && byId.get(id)!.locked);
  const picks = unique(selected);
  return { selected: picks.filter(keep), dropped: picks.filter((id) => !keep(id)) };
}

/** Why the server refused an audience, as a message key under `audience.errors`. */
export const AUDIENCE_REFUSALS = [
  ["required attendee", "requiredAttendee"],
  ["open follow-up", "followUp"],
  ["invited and left out", "invitedLeftOut"],
  ["always sees it", "locked"],
  ["already see it", "cannotSee"],
  ["your company's own items", "ownPeople"],
  ["at least one person", "onlyEmpty"],
  ["project is closed", "closed"],
  ["file is archived", "archived"],
] as const;
export type AudienceRefusal = (typeof AUDIENCE_REFUSALS)[number][1];

/** The refusal a server sentence names (the database's own words, in English), or null for anything else. */
export function audienceRefusal(message: string | null | undefined): AudienceRefusal | null {
  if (!message) return null;
  return AUDIENCE_REFUSALS.find(([words]) => message.includes(words))?.[1] ?? null;
}

/**
 * The picks after moving the switch. A chip means the opposite in the other
 * position (left out, or let in), so no chip crosses over: each position gets
 * back what it had in this session, and starts empty (only the locked people,
 * for "only") the first time. Nobody's access changes until the item is saved.
 */
export function switchAudience(
  to: AudienceSwitch,
  remembered: Partial<Record<AudienceSwitch, readonly string[]>>,
  locked: readonly string[],
): { mode: AudienceMode; selected: string[] } {
  const selected = audienceSelection(to, remembered[to] ?? [], locked);
  return { mode: audienceMode(to, selected, locked), selected };
}
