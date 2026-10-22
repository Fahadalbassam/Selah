import { describe, expect, it } from "vitest";
import { chatTitle, fuse, keywordQuery } from "@/lib/assistant-search";
import { createMasker } from "@/lib/masking";

describe("keyword query", () => {
  it("keeps distinctive words in both languages, joined by OR", () => {
    expect(keywordQuery("What does Article 12 of the charter say?")).toBe("article | 12 | of | charter | say");
    expect(keywordQuery("ما الذي بقي مفتوحاً في ميثاق المجلس؟")).toBe("بقي | مفتوحا | ميثاق | المجلس");
  });

  it("can't inject query syntax, and is null when nothing is left", () => {
    expect(keywordQuery("a & !b | (c:*) <-> 'd'")).toBeNull();
    expect(keywordQuery("board' | !charter:*")).toBe("board | charter");
    expect(keywordQuery("the and of")).toBe("of");
  });
});

describe("rank fusion", () => {
  const items = (...ids: string[]) => ids.map((id) => ({ id }));
  it("rewards items found by both searches, and boosts the case", () => {
    expect(fuse([items("a", "b", "c"), items("c", "d")], 3).map((x) => x.id)).toEqual(["c", "a", "b"]);
    expect(fuse([items("a", "b", "c"), items("c", "d")], 2, (x) => x.id === "d").map((x) => x.id)).toEqual(["d", "c"]);
    expect(fuse([items("a"), []], 5)).toEqual(items("a"));
  });
});

describe("chat titles", () => {
  it("is the first question on one line, cut at 60 characters", () => {
    expect(chatTitle("  What is\n still open?  ")).toBe("What is still open?");
    const long = chatTitle("x".repeat(80));
    expect(long).toHaveLength(60);
    expect(long.endsWith("…")).toBe(true);
  });
});

describe("masking", () => {
  const terms = [
    { kind: "ORG", term: "Al-Nukhba Holding" },
    { kind: "ORG", term: "شركة النخبة القابضة" },
    { kind: "PERSON", term: "Reem Al-Harbi" },
    { kind: "DEPT", term: "Finance" },
  ];

  it("replaces known names, emails, phones and cities, and puts them back", () => {
    const m = createMasker(terms, { places: true });
    const text = "Reem Al-Harbi of Al-Nukhba Holding (reem@x.example, +966 55 123 4567) in Riyadh; ask Reem in finance.";
    const masked = m.mask(text);
    expect(masked).toBe("[PERSON_1] of [ORG_1] ([EMAIL_1], [PHONE_1]) in [PLACE_1]; ask [PERSON_2] in [DEPT_1].");
    expect(m.unmask(masked)).toBe(text);
    expect(m.replaced).toBe(7);
  });

  it("finds Arabic names after a prefix and without short vowels", () => {
    const m = createMasker(terms);
    expect(m.mask("تعمل لشركة النخبة القابضة")).toBe("تعمل ل[ORG_1]");
    expect(m.mask("شَرِكة النخبة القابضة")).toBe("[ORG_1]");
  });

  it("matches whole Latin words only, longest first", () => {
    const m = createMasker([...terms, { kind: "ORG", term: "Al-Nukhba" }]);
    expect(m.mask("Refinanced by Al-Nukhba and Al-Nukhba Holding")).toBe("Refinanced by [ORG_1] and [ORG_2]");
  });

  it("changes nothing when off", () => {
    const m = createMasker([]);
    expect(m.mask("Reem in Riyadh, 0551234567")).toBe("Reem in Riyadh, 0551234567");
    expect(m.unmask("[ORG_1]")).toBe("[ORG_1]");
  });
});
