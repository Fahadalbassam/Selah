import { describe, expect, it } from "vitest";
import { chatTitle, fuse, keywordQuery, statusIntent } from "@/lib/assistant-search";
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

  it("gives one placeholder to a record's names in both languages", () => {
    const m = createMasker([
      { kind: "ORG", term: "Al-Nukhba Holding", entity: "org:1" },
      { kind: "ORG", term: "شركة النخبة القابضة", entity: "org:1" },
      { kind: "ORG", term: "Rawdah Group", entity: "org:2" },
      { kind: "PERSON", term: "Reem Al-Harbi", entity: "user:1" },
    ]);
    expect(m.mask("Al-Nukhba Holding (شركة النخبة القابضة) and Rawdah Group")).toBe("[ORG_1] ([ORG_1]) and [ORG_2]");
    // A part of the name is the same person; the answer gets the name as first seen.
    expect(m.mask("Reem Al-Harbi, then Reem")).toBe("[PERSON_1], then [PERSON_1]");
    expect(m.unmask("[ORG_1] asked [PERSON_1]")).toBe("Al-Nukhba Holding asked Reem Al-Harbi");
    // GPT-OSS sometimes drops the brackets (client run, 2026-10-24); unknown ones stay as written.
    expect(m.unmask("circulated by PERSON_1 of ORG_1, not PERSON_9 or XPERSON_1")).toBe(
      "circulated by Reem Al-Harbi of Al-Nukhba Holding, not PERSON_9 or XPERSON_1",
    );
  });

  it("finds a Latin name however its parts are joined, and counts them as one", () => {
    const m = createMasker([
      { kind: "PERSON", term: "ريم الحربي", entity: "user:1" },
      { kind: "PERSON", term: "Reem Al-Harbi", entity: "user:1" },
      { kind: "ORG", term: "Al-Nukhba", entity: "org:1" },
    ]);
    expect(m.mask("Reem Al Harbi, Reem Alharbi, reem el-harbi, Al‑Harbi, Harbi")).toBe(
      "[PERSON_1], [PERSON_1], [PERSON_1], [PERSON_1], [PERSON_1]",
    );
    expect(m.mask("AlNukhba and Al Nukhba and El-Nukhba")).toBe("[ORG_1] and [ORG_1] and [ORG_1]");
    expect(m.mask("ريم الحربي")).toBe("[PERSON_1]");
    // Whole words only: "Alnukhbawi" is someone else.
    expect(m.mask("Alnukhbawi")).toBe("Alnukhbawi");
  });

  it("changes nothing when off", () => {
    const m = createMasker([]);
    expect(m.mask("Reem in Riyadh, 0551234567")).toBe("Reem in Riyadh, 0551234567");
    expect(m.unmask("[ORG_1]")).toBe("[ORG_1]");
  });
});

describe("status questions", () => {
  const kinds = (q: string) => [...statusIntent(q)].sort();

  it("notices questions about the state of the work, in both languages", () => {
    expect(kinds("What is overdue on this project?")).toEqual(["overdue"]);
    expect(kinds("Which actions are blocked or stuck?")).toEqual(["blocked"]);
    expect(kinds("What is awaiting review?")).toEqual(["review"]);
    expect(kinds("What's due this week?")).toEqual(["due_soon"]);
    expect(kinds("ما الإجراءات المتأخرة؟")).toEqual(["overdue"]);
    expect(kinds("ما المتعثر في المشروع؟")).toEqual(["blocked"]);
    expect(kinds("ما الذي بانتظار المراجعة؟")).toEqual(["review"]);
    expect(kinds("ما المستحق هذا الأسبوع؟")).toEqual(["due_soon"]);
    expect(kinds("ما الإجراءات التي لم تنجز بعد؟")).toEqual(["open"]);
  });

  it("leaves questions about what files say to search", () => {
    expect(kinds("What does Article 12 of the charter say?")).toEqual([]);
    expect(kinds("ما صلاحيات لجنة المراجعة في الميثاق؟")).toEqual([]);
    expect(kinds("Who chairs the audit committee?")).toEqual([]);
  });
});
