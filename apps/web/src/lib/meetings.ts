// Shared by the meeting screens. The database is the real check
// (baseline: Meetings); these give an answer before saving.

/** Call links Selah accepts: https on Google Meet, Teams or Zoom. */
export function callProvider(url: string): "google_meet" | "teams" | "zoom" | null {
  const host = /^https:\/\/([^/?#]+)/i.exec(url.trim())?.[1]?.toLowerCase();
  if (!host) return null;
  if (host === "meet.google.com") return "google_meet";
  if (host === "teams.microsoft.com" || host === "teams.live.com") return "teams";
  if (host === "zoom.us" || /^[a-z0-9-]+\.zoom\.us$/.test(host)) return "zoom";
  return null;
}

// Times are entered and shown in Riyadh time, whatever the browser's own zone.
// Saudi Arabia has kept UTC+3 all year since 1957, so a fixed offset is exact.
const RIYADH_OFFSET_MS = 3 * 60 * 60 * 1000;

/** A Riyadh date (YYYY-MM-DD) and time (HH:MM) as an instant. */
export function localInstant(date: string, time: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const d = new Date(`${date}T${time}:00+03:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** The reverse of localInstant, for prefilling a form. */
export function localParts(d: Date): { date: string; time: string } {
  const r = new Date(d.getTime() + RIYADH_OFFSET_MS);
  const p = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${r.getUTCFullYear()}-${p(r.getUTCMonth() + 1)}-${p(r.getUTCDate())}`,
    time: `${p(r.getUTCHours())}:${p(r.getUTCMinutes())}`,
  };
}

export const DURATIONS = [30, 45, 60, 90, 120] as const;

/** The language a meeting (or its transcript) is held in; the database checks the same list. */
export const SPOKEN_LANGS = ["ar", "en", "mixed"] as const;
export type SpokenLang = (typeof SPOKEN_LANGS)[number];

/** A person the organiser may invite, as app_meeting_invitees() describes them. */
export interface InviteePerson {
  userId: string;
  name: string;
  /** Could open a meeting of the whole project (the firm, the client's admin, an action owner, a manager no department limit stops). */
  wholeProject: boolean;
  departmentIds: string[];
}

/**
 * Who among the people chosen could not open the meeting (decision 1a). A
 * meeting of the whole project opens only for people who may see all of the
 * project's work, so a manager limited to her departments would be invited
 * to a meeting she cannot open. Nobody for a department's meeting: whoever
 * is invited to one opens it. The server decides; this only warns before
 * saving.
 */
export function leftOutOfMeeting<P extends InviteePerson>(people: readonly P[], chosen: Iterable<string>, departmentId: string | null): P[] {
  if (departmentId) return [];
  const picked = new Set(chosen);
  return people.filter((p) => picked.has(p.userId) && !p.wholeProject);
}

/** The departments to offer instead: those of the people left out that the organiser may book a meeting for. */
export function departmentsToOffer<D extends { id: string }>(leftOut: readonly InviteePerson[], bookable: readonly D[]): D[] {
  const theirs = new Set(leftOut.flatMap((p) => p.departmentIds));
  return bookable.filter((d) => theirs.has(d.id));
}

/** A data rule's words (see callApi) as one of the meeting screens' messages. */
export function meetingError(message: string | undefined): string | null {
  if (!message) return null;
  if (/Google Meet, Teams or Zoom/.test(message)) return "badLink";
  if (/cannot open/.test(message)) return "cannotOpen";
  if (/firm-private/.test(message)) return "firmPrivate";
  if (/cannot be moved/.test(message)) return "cannotMove";
  if (/another meeting/.test(message)) return "otherMeeting";
  if (/one of your departments/.test(message)) return "wholeProject";
  if (/invite them to a department's meeting/.test(message)) return "invitedLimited";
  return null;
}

/**
 * What the meeting page draws (page audit U14, batch 1). Before the meeting
 * it shows what a person needs to attend: the time, the place or the call
 * link, the agenda and who is invited. The record (summary, decisions,
 * follow-ups, the firm's transcript) appears once it is held; a cancelled
 * meeting has none. A follow-up someone already wrote on a meeting not yet
 * held stays listed, so no work disappears from the page.
 */
export function meetingSections(status: string, followUps: number) {
  const held = status === "held";
  return {
    summary: held,
    decisions: held,
    transcript: held,
    followUps: held || followUps > 0,
    /** Adding a follow-up, recording a decision, writing the summary. */
    record: held,
  };
}
