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
const OLD_STATUS = new RegExp(`^(.*) \\((${CHANGED_STATUSES.join("|")})\\)$`);

export type AgendaLine = { kind: "heading" | "item" | "text"; text: string };

export function agendaLines(
  md: string,
  words: { status: (key: AgendaStatus) => string; date: (isoDay: string) => string },
): AgendaLine[] {
  const out: AgendaLine[] = [];
  let section: "overdue" | "changed" | null = null;
  for (const line of md.split("\n")) {
    if (line.startsWith("## ")) {
      const text = line.slice(3);
      section = OVERDUE_HEADINGS.has(text) ? "overdue" : CHANGED_HEADINGS.has(text) ? "changed" : null;
      out.push({ kind: "heading", text });
    } else if (line.startsWith("- ")) {
      let text = line.slice(2);
      if (section === "overdue") {
        const m = OLD_DUE.exec(text);
        if (m) text = `${m[1]} (${m[2]} ${words.date(m[3]!)})`;
      } else if (section === "changed") {
        const m = OLD_STATUS.exec(text);
        if (m) text = `${m[1]} (${words.status(m[2] as AgendaStatus)})`;
      }
      out.push({ kind: "item", text });
    } else if (line) {
      out.push({ kind: "text", text: line });
    }
  }
  return out;
}
