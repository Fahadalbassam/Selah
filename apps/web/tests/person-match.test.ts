// "Give to a colleague" search (Gate B): a name is found in either language,
// whatever the case, Arabic short vowels, tatweel or alef spelling; and the
// action page says the firm admin reviews when nobody else on the team can.
import { describe, expect, it } from "vitest";
import { personMatches } from "@/lib/person-match";
import { reviewNote } from "@/lib/review-note";

describe("personMatches", () => {
  const salma = ["سلمى الشهري", "Salma Al-Shehri"]; // the name, and the name in the other language
  it("finds an English name by English letters, in any case", () => {
    expect(personMatches(salma, "Salma")).toBe(true);
    expect(personMatches(salma, "salma")).toBe(true);
    expect(personMatches(salma, "SHEHRI")).toBe(true);
    expect(personMatches(salma, "reem")).toBe(false);
  });
  it("finds an Arabic name, ignoring vowels, tatweel and alef or ya spelling", () => {
    expect(personMatches(salma, "سلمى")).toBe(true);
    expect(personMatches(salma, "سَلْمَى")).toBe(true);
    expect(personMatches(salma, "سلمـــى")).toBe(true);
    expect(personMatches(salma, "سلمي")).toBe(true);
    expect(personMatches(["أحمد العتيبي"], "احمد")).toBe(true);
    expect(personMatches(["إبراهيم"], "ابراهيم")).toBe(true);
    expect(personMatches(["فاطمة"], "فاطمه")).toBe(true);
  });
  it("matches an email's local part and ignores Latin accents", () => {
    expect(personMatches([undefined, "salma.shehri@example.test"], "shehri")).toBe(true);
    expect(personMatches(["José"], "jose")).toBe(true);
  });
  it("an empty query matches everyone, and no text matches nothing", () => {
    expect(personMatches(salma, "  ")).toBe(true);
    expect(personMatches([null, undefined], "a")).toBe(false);
  });
});

describe("reviewNote (review D5)", () => {
  it("names the other reviewers when there are some", () => {
    expect(reviewNote(["Reem"], false)).toBe("names");
    expect(reviewNote(["Reem"], true)).toBe("names");
  });
  it("says the firm admin reviews only when nobody else on the team can", () => {
    expect(reviewNote([], false)).toBe("firmAdmin");
  });
  it("does not promise a firm admin review to the firm admin who sent it", () => {
    expect(reviewNote([], true)).toBe("nobody");
  });
});
