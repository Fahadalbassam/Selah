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

/** A data rule's words (see callApi) as one of the meeting screens' messages. */
export function meetingError(message: string | undefined): string | null {
  if (!message) return null;
  if (/Google Meet, Teams or Zoom/.test(message)) return "badLink";
  if (/cannot open/.test(message)) return "cannotOpen";
  if (/firm-private/.test(message)) return "firmPrivate";
  if (/cannot be moved/.test(message)) return "cannotMove";
  if (/another meeting/.test(message)) return "otherMeeting";
  return null;
}
