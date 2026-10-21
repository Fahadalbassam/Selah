// Calendar invites as RFC 5545 text. Pure: the meetings service and the
// mail sender pass the meeting in. Times are written in UTC, which every
// calendar converts to the reader's zone.

export interface IcsMeeting {
  uid: string;
  sequence: number;
  status: "scheduled" | "held" | "cancelled";
  title: string;
  startsAt: Date;
  endsAt: Date;
  joinUrl: string | null;
  locationText: string | null;
  organizer: { name: string; email: string };
  attendees: { name: string; email: string; optional?: boolean }[];
  updatedAt: Date;
}

/** Escape a TEXT value (RFC 5545 3.3.11). */
export function escapeText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** A parameter value such as CN, quoted, without the characters a quoted value cannot hold. */
const param = (value: string) => `"${value.replace(/["\r\n]/g, "")}"`;

/** Fold a content line at 75 octets, never inside a UTF-8 character (RFC 5545 3.1). */
export function fold(line: string): string {
  const out: string[] = [];
  let current = "";
  let octets = 0;
  for (const ch of line) {
    const size = Buffer.byteLength(ch);
    const limit = out.length === 0 ? 75 : 74; // continuation lines start with a space
    if (octets + size > limit) {
      out.push(current);
      current = "";
      octets = 0;
    }
    current += ch;
    octets += size;
  }
  out.push(current);
  return out.join("\r\n ");
}

const stamp = (d: Date) =>
  d
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");

export function buildIcs(m: IcsMeeting): string {
  const cancelled = m.status === "cancelled";
  const location = m.joinUrl ?? m.locationText;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Selah//Meetings//EN",
    "CALSCALE:GREGORIAN",
    `METHOD:${cancelled ? "CANCEL" : "REQUEST"}`,
    "BEGIN:VEVENT",
    `UID:${m.uid}`,
    `SEQUENCE:${m.sequence}`,
    `DTSTAMP:${stamp(m.updatedAt)}`,
    `DTSTART:${stamp(m.startsAt)}`,
    `DTEND:${stamp(m.endsAt)}`,
    `SUMMARY:${escapeText(m.title)}`,
    ...(location ? [`LOCATION:${escapeText(location)}`] : []),
    ...(m.joinUrl ? [`URL:${m.joinUrl}`, `DESCRIPTION:${escapeText(m.joinUrl)}`] : []),
    `STATUS:${cancelled ? "CANCELLED" : "CONFIRMED"}`,
    `ORGANIZER;CN=${param(m.organizer.name)}:mailto:${m.organizer.email}`,
    ...m.attendees.map(
      (a) =>
        `ATTENDEE;CN=${param(a.name)};ROLE=${a.optional ? "OPT-PARTICIPANT" : "REQ-PARTICIPANT"};RSVP=TRUE:mailto:${a.email}`,
    ),
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}
