// The stored meeting agenda (docs/meetings.md) is one text the database wrote
// when the meeting was booked: "## heading" lines and "- item" lines. Until
// migration 0072 it wrote an action's status as its database key
// ("(in_progress)") and its date as "2026-11-12". Agendas already stored keep
// their text; this turns those two into words and a date when the page draws
// them. The stored text is never rewritten, so a title that happens to end in
// such a word cannot be corrupted: at worst one line is drawn as it was stored.

/** The statuses an action in "Changed since the last meeting" can have (drafts are never listed). */
const CHANGED_STATUSES = ["assigned", "in_progress", "blocked", "awaiting_review", "revision_requested", "verified_complete", "closed"] as const;
export type AgendaStatus = (typeof CHANGED_STATUSES)[number];

const OVERDUE_HEADINGS = new Set(["Overdue", "متأخرة"]);
const CHANGED_HEADINGS = new Set(["Changed since the last meeting", "ما تغيّر منذ الاجتماع السابق"]);

// Only the last bracket of a line, and only under the heading where the database put one there.
const OLD_DUE = /^(.*) \((due|الاستحقاق) (\d{4}-\d{2}-\d{2})\)$/;
// The same, for an agenda written in words (migration 0072 onward): the last bracket only.
const READER_DUE = /^(.*) \((due|الاستحقاق) (.+)\)$/;
const LAST_BRACKET = /^(.*) \((.+)\)$/;
const OLD_STATUS = new RegExp(`^(.*) \\((${CHANGED_STATUSES.join("|")})\\)$`);

export type AgendaLine = { kind: "heading" | "item" | "text"; text: string };

/** The four headings the database writes, in either language, by what they mean. */
export type AgendaHeading = "overdue" | "awaiting" | "blocked" | "changed";
const HEADINGS: Record<string, AgendaHeading> = {
  Overdue: "overdue",
  "متأخرة": "overdue",
  "Awaiting review": "awaiting",
  "بانتظار المراجعة": "awaiting",
  Blocked: "blocked",
  "متوقفة": "blocked",
  "Changed since the last meeting": "changed",
  "ما تغيّر منذ الاجتماع السابق": "changed",
};

// The status words the database appends under "Changed", in either language (app_action_status_label, migration 0072).
const STORED_STATUS: Record<string, AgendaStatus> = {
  Assigned: "assigned",
  "In progress": "in_progress",
  Blocked: "blocked",
  "Awaiting review": "awaiting_review",
  "Revision requested": "revision_requested",
  "Verified complete": "verified_complete",
  Closed: "closed",
  "مُسند": "assigned",
  "قيد التنفيذ": "in_progress",
  "متعثر": "blocked",
  "بانتظار المراجعة": "awaiting_review",
  "مطلوب تعديل": "revision_requested",
  "مكتمل ومُتحقق منه": "verified_complete",
  "مغلق": "closed",
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A day as the database printed it ("Nov 2, 2026", "02/11/2026" with its direction marks, or "2026-11-02") as an ISO day; null when it is none of those. */
function storedDay(text: string): string | null {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (iso) return text;
  const en = /^([A-Z][a-z]{2}) (\d{1,2}), (\d{4})$/.exec(text);
  if (en && MONTHS.includes(en[1]!)) return `${en[3]}-${String(MONTHS.indexOf(en[1]!) + 1).padStart(2, "0")}-${en[2]!.padStart(2, "0")}`;
  const ar = /^(\d{2})\u200F?\/(\d{2})\u200F?\/(\d{4})$/.exec(text);
  return ar ? `${ar[3]}-${ar[2]}-${ar[1]}` : null;
}

/**
 * `reader`: draw the headings, the "due" word, the dates and the status words in the
 * reader's language, not the one the agenda was stored in. The meeting's own
 * words (the action titles, a blocked reason) are left as written.
 */
export function agendaLines(
  md: string,
  words: {
    status: (key: AgendaStatus) => string;
    date: (isoDay: string) => string;
    reader?: { heading: (key: AgendaHeading) => string; due: string };
  },
): AgendaLine[] {
  const out: AgendaLine[] = [];
  let section: "overdue" | "changed" | null = null;
  for (const line of md.split("\n")) {
    if (line.startsWith("## ")) {
      const text = line.slice(3);
      section = OVERDUE_HEADINGS.has(text) ? "overdue" : CHANGED_HEADINGS.has(text) ? "changed" : null;
      const kind = words.reader ? HEADINGS[text] : undefined;
      out.push({ kind: "heading", text: kind ? words.reader!.heading(kind) : text });
    } else if (line.startsWith("- ")) {
      let text = line.slice(2);
      if (section === "overdue") {
        const m = OLD_DUE.exec(text);
        if (m) text = `${m[1]} (${words.reader?.due ?? m[2]} ${words.date(m[3]!)})`;
        else if (words.reader) {
          const r = READER_DUE.exec(text);
          const iso = r ? storedDay(r[3]!) : null;
          if (r) text = `${r[1]} (${words.reader.due} ${iso ? words.date(iso) : r[3]})`;
        }
      } else if (section === "changed") {
        const m = OLD_STATUS.exec(text);
        if (m) text = `${m[1]} (${words.status(m[2] as AgendaStatus)})`;
        else if (words.reader) {
          const r = LAST_BRACKET.exec(text);
          const key = r ? STORED_STATUS[r[2]!] : undefined;
          if (r && key) text = `${r[1]} (${words.status(key)})`;
        }
      }
      out.push({ kind: "item", text });
    } else if (line) {
      out.push({ kind: "text", text: line });
    }
  }
  return out;
}
