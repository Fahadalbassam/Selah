// Agendas stored before migration 0072 carry status keys and plain dates.
// The meeting page draws them in words; the stored text is never rewritten.
import { describe, expect, it } from "vitest";
import { agendaLines } from "@/lib/agenda";

const words = { status: (key: string) => `<${key}>`, date: (iso: string) => `[${iso}]` };
const items = (md: string) =>
  agendaLines(md, words)
    .filter((l) => l.kind === "item")
    .map((l) => l.text);

describe("a stored agenda", () => {
  it("draws the old status keys and dates in words, under the headings where the database wrote them", () => {
    const md = [
      "## متأخرة",
      "- مراجعة حدود الصلاحيات (الاستحقاق 2026-11-12)",
      "",
      "## بانتظار المراجعة",
      "- عرض المسودة على المجلس",
      "",
      "## ما تغيّر منذ الاجتماع السابق",
      "- إعداد لائحة عمل اللجنة (revision_requested)",
      "- نشر الميثاق (in_progress)",
    ].join("\n");
    expect(agendaLines(md, words)).toEqual([
      { kind: "heading", text: "متأخرة" },
      { kind: "item", text: "مراجعة حدود الصلاحيات (الاستحقاق [2026-11-12])" },
      { kind: "heading", text: "بانتظار المراجعة" },
      { kind: "item", text: "عرض المسودة على المجلس" },
      { kind: "heading", text: "ما تغيّر منذ الاجتماع السابق" },
      { kind: "item", text: "إعداد لائحة عمل اللجنة (<revision_requested>)" },
      { kind: "item", text: "نشر الميثاق (<in_progress>)" },
    ]);
    expect(items("## Overdue\n- Adopt the charter (due 2026-01-05)\n\n## Changed since the last meeting\n- Adopt the charter (closed)")).toEqual([
      "Adopt the charter (due [2026-01-05])",
      "Adopt the charter (<closed>)",
    ]);
  });

  it("never touches a title that happens to contain such a word", () => {
    // Under "Blocked" and "Awaiting review" the database appended nothing, so a bracket there is the title's own.
    expect(items("## Blocked\n- Unblock the vendor (blocked): waiting\n- Close the file (closed)\n\n## Awaiting review\n- Review (in_progress)")).toEqual([
      "Unblock the vendor (blocked): waiting",
      "Close the file (closed)",
      "Review (in_progress)",
    ]);
    // Under "Changed" only the last bracket is the status the database appended.
    expect(items("## Changed since the last meeting\n- Move tickets (blocked) to done (in_progress)")).toEqual(["Move tickets (blocked) to done (<in_progress>)"]);
    // A date inside a title is not the due date.
    expect(items("## Overdue\n- Budget (due 2025-01-01) review (due 2026-03-04)")).toEqual(["Budget (due 2025-01-01) review (due [2026-03-04])"]);
  });

  it("leaves an agenda written in words as it is", () => {
    const md = "## Overdue\n- Adopt the charter (due Nov 12, 2026)\n\n## Changed since the last meeting\n- Adopt the charter (In progress)\n- Fix (blocked) (Blocked)";
    expect(items(md)).toEqual(["Adopt the charter (due Nov 12, 2026)", "Adopt the charter (In progress)", "Fix (blocked) (Blocked)"]);
    const ar = "## متأخرة\n- مراجعة (الاستحقاق 12‏/11‏/2026)\n\n## ما تغيّر منذ الاجتماع السابق\n- مراجعة (قيد التنفيذ)";
    expect(items(ar)).toEqual(["مراجعة (الاستحقاق 12‏/11‏/2026)", "مراجعة (قيد التنفيذ)"]);
  });

  it("draws the headings, the due word, the dates and the status words in the reader's language, and leaves the titles alone", () => {
    const reader = { heading: (k: string) => `{${k}}`, due: "due-in-reader" };
    const read = (md: string) => agendaLines(md, { ...words, reader });
    // A meeting stored in one language, read in the other: the stored words are looked up, not guessed.
    const ar = ["## متأخرة", "- مراجعة الميثاق (الاستحقاق 12‏/11‏/2026)", "", "## متوقفة", "- نشر (الاستحقاق): ينتظر المورد", "", "## ما تغيّر منذ الاجتماع السابق", "- نشر الميثاق (قيد التنفيذ)"].join("\n");
    expect(read(ar)).toEqual([
      { kind: "heading", text: "{overdue}" },
      { kind: "item", text: "مراجعة الميثاق (due-in-reader [2026-11-12])" },
      { kind: "heading", text: "{blocked}" },
      { kind: "item", text: "نشر (الاستحقاق): ينتظر المورد" },
      { kind: "heading", text: "{changed}" },
      { kind: "item", text: "نشر الميثاق (<in_progress>)" },
    ]);
    const en = "## Overdue\n- Adopt the charter (due Nov 2, 2026)\n\n## Awaiting review\n- Review (Closed)\n\n## Changed since the last meeting\n- Adopt the charter (Awaiting review)";
    expect(read(en)).toEqual([
      { kind: "heading", text: "{overdue}" },
      { kind: "item", text: "Adopt the charter (due-in-reader [2026-11-02])" },
      { kind: "heading", text: "{awaiting}" },
      { kind: "item", text: "Review (Closed)" },
      { kind: "heading", text: "{changed}" },
      { kind: "item", text: "Adopt the charter (<awaiting_review>)" },
    ]);
  });
});
