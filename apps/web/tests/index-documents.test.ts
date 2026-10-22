import { describe, expect, it } from "vitest";
import { pagesFromText, passages } from "@/jobs/index-documents";

describe("search index passages", () => {
  it("numbers pages at form feeds and keeps empty pages' numbers", () => {
    expect(pagesFromText("one\ftwo\f\ffour")).toEqual([
      { n: 1, text: "one" },
      { n: 2, text: "two" },
      { n: 3, text: "" },
      { n: 4, text: "four" },
    ]);
  });

  it("joins short paragraphs, never across pages", () => {
    expect(passages(pagesFromText("a\n\nb\fc"))).toEqual([
      { page: 1, text: "a\n\nb" },
      { page: 2, text: "c" },
    ]);
  });

  it("keeps every passage within the size, cutting a line that is too long", () => {
    const long = "x".repeat(3000);
    const para = "y".repeat(700);
    const out = passages([{ n: 7, text: `${para}\n\n${para}\n\n${long}\n\nend` }]);
    expect(out.every((p) => p.text.length <= 1200 && p.page === 7)).toBe(true);
    expect(out.map((p) => p.text.replace(/\n\n/g, "")).join("")).toBe(`${para}${para}${long}end`);
  });

  it("gives nothing for a file with no text", () => {
    expect(passages(pagesFromText(" \n\n \f"))).toEqual([]);
  });
});
