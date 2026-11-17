// Screen texts from the page audit (batch 0) that must say what the rules
// do, in both languages, checked against the real message catalogues.
import { describe, expect, it } from "vitest";
import ar from "../messages/ar.json";
import en from "../messages/en.json";

describe("Today: who decides a date change (N27)", () => {
  // The rule (app_can_extend()): any consultant on the project decides the first
  // two moves; a third move later needs the client's lead, an internal project's
  // lead or a firm admin. The text said only "the lead or the firm admin".
  it("says any consultant on the project decides, and who decides a third move later", () => {
    const enText = en.todayPage.decisions.description;
    expect(enText).toMatch(/any consultant on the project/i);
    expect(enText).toMatch(/third time/);
    expect(enText).toMatch(/internal project's lead/);
    const arText = ar.todayPage.decisions.description;
    expect(arText).toContain("أي مستشار في المشروع");
    expect(arText).toContain("للمرة الثالثة");
    expect(arText).toContain("قائد المشروع الداخلي");
  });
});
