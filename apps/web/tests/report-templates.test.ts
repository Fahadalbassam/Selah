// Report note templates: each one exists in both languages, uses no rating
// words, fills what is known and leaves out what is not, and never replaces
// a note that already has text without a yes.
import { describe, expect, it } from "vitest";
import ar from "../messages/ar.json";
import en from "../messages/en.json";
import { noteAfterChoosing, REPORT_TEMPLATES, reportTemplate, templateFill, type TemplateCounts } from "@/lib/report-templates";

const counts: TemplateCounts = { total: 20, verified: 9, partially: 2, riskAccepted: 1, notApplicable: 2, superseded: 1, open: 5, overdue: 3, extended: 4, decisions: 2 };
const facts = { start: "2026-10-01", end: "2026-10-31", counts };

const RATING = [
  /\bgood\b/i, /\bgreat\b/i, /excellent/i, /on track/i, /off track/i, /behind/i, /ahead of/i, /\bpoor/i, /strong/i, /weak/i, /success/i, /satisf/i, /concern/i, /worr/i, /\bproblem/i, /\bbad\b/i,
  /جيد/, /ممتاز/, /على المسار/, /خارج المسار/, /متأخر/, /ضعيف/, /قوي/, /ناجح/, /مرض/, /قلق/, /مشكل/, /سيئ/,
];

describe("report templates", () => {
  it("has monthly progress, steering summary and closing summary, with a chooser label in both languages", () => {
    expect([...REPORT_TEMPLATES]).toEqual(["monthly", "steering", "closing"]);
    for (const x of [ar, en]) {
      for (const id of REPORT_TEMPLATES) expect(x.reportTemplates[id].length).toBeGreaterThan(0);
      expect(x.reportTemplates.none.length).toBeGreaterThan(0);
      for (const rating of RATING) expect(JSON.stringify(x.reportTemplates)).not.toMatch(rating);
    }
  });

  for (const id of REPORT_TEMPLATES)
    for (const lang of ["ar", "en"] as const)
      it(`${id} in ${lang}: has headings and uses no rating words`, () => {
        const text = reportTemplate(id, lang, facts);
        expect(text.split("\n").filter((l) => /^\d\. /.test(l)).length).toBeGreaterThanOrEqual(4);
        for (const r of RATING) expect(text).not.toMatch(r);
        expect(/[؀-ۿ]/.test(text)).toBe(lang === "ar");
      });

  it("fills the period and the counts from the report's own numbers", () => {
    const text = reportTemplate("monthly", "en", facts);
    expect(text).toContain("Monthly progress, Oct 1, 2026 to Oct 31, 2026");
    expect(text).toContain("- Actions that apply: 17");
    expect(text).toContain("- Verified: 9");
    expect(text).toContain("- Open and past their date: 3");
    expect(reportTemplate("steering", "en", facts)).toContain("- Decisions waiting for you: 2");
    expect(reportTemplate("closing", "en", facts)).toContain("- Not applicable: 2");
    expect(reportTemplate("monthly", "ar", facts)).toMatch(/من .+ إلى /);
  });

  it("leaves out numbers it does not have, and shows the dates it does", () => {
    const text = reportTemplate("monthly", "en", { start: "2026-10-01", end: "2026-10-31" });
    expect(text).toContain("Oct 1, 2026");
    expect(text).not.toContain("Verified");
    expect(text).not.toContain("Actions in numbers");
    expect(text).toMatch(/^1\. What was done this period/m);
    expect(reportTemplate("closing", "ar")).not.toMatch(/\d{2,}/);
  });

  it("keeps to the report's own numbers: nothing about the firm's own work", () => {
    for (const id of REPORT_TEMPLATES)
      for (const lang of ["ar", "en"] as const) expect(reportTemplate(id, lang, facts)).not.toMatch(/internal|firm-only|private|داخلي|للفريق فقط/i);
  });

  it("never overwrites a note that has text without a yes", () => {
    const outline = reportTemplate("monthly", "en", facts);
    expect(templateFill("")).toBe("fill");
    expect(templateFill("  \n")).toBe("fill");
    expect(templateFill("From Use as draft")).toBe("ask");
    expect(noteAfterChoosing("", outline, false)).toBe(outline);
    expect(noteAfterChoosing("From Use as draft", outline, false)).toBe("From Use as draft");
    expect(noteAfterChoosing("From Use as draft", outline, true)).toBe(outline);
  });
});
