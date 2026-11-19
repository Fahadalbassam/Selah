import { describe, expect, it } from "vitest";
import { chatTitle, fuse, indicatorIntent, keywordQuery, statusIntent } from "@/lib/assistant-search";
import { createMasker } from "@/lib/masking";

describe("keyword query", () => {
  it("keeps distinctive words in both languages, joined by OR", () => {
    expect(keywordQuery("What does Article 12 of the charter say?")).toBe("article | 12 | of | charter | say");
    // Each Arabic word also without its prefix, as the index holds it (app_search_tsv).
    expect(keywordQuery("ما الذي بقي مفتوحاً في ميثاق المجلس؟")).toBe("بقي | مفتوحا | ميثاق | المجلس | مجلس");
  });

  it("asks in the index's fold: hamza and alef forms, ى, ة, tatweel, Arabic-Indic digits", () => {
    expect(keywordQuery("أعضاء لجنة المراجعة ٢٠٢٧")).toBe("اعضاء | لجنه | جنه | المراجعه | مراجعه | 2027");
    expect(keywordQuery("المسؤول والمسئول")).toBe("المسءول | مسءول | والمسءول");
    expect(keywordQuery("مكافـــآت الإدارة")).toBe("مكافات | الاداره | اداره");
    // A stop word stays out folded too («إلى» is «الى»), and so does a stem that is one («وهذا»).
    expect(keywordQuery("إلى وهذا البنك")).toBe("وهذا | البنك | بنك");
    // Fewer than three letters left: «بنك» is not also «نك».
    expect(keywordQuery("بنك")).toBe("بنك");
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

  it("finds an Arabic name in every spelling the search fold joins (phase 3 probes)", () => {
    const m = createMasker([
      { kind: "PERSON", term: "أحمد العتيبي", entity: "user:2" },
      { kind: "PERSON", term: "ريم الحربي", entity: "user:1" },
      { kind: "ORG", term: "مؤسسة الرعاية", entity: "org:3" },
    ]);
    // Hamza: «احمد» for «أحمد», the first name alone too.
    expect(m.mask("رسالة من احمد العتيبي و إلى أحمد")).toBe("رسالة من [PERSON_1] و إلى [PERSON_1]");
    // Tatweel.
    expect(m.mask("ريـــم الحربي (with tatweel)")).toBe("[PERSON_2] (with tatweel)");
    expect(m.mask("الحـــربي")).toBe("[PERSON_2]");
    expect(m.mask("ريمـ الحربيـ")).toBe("[PERSON_2]");
    // ؤ and ئ, ة and ه.
    expect(m.mask("مئسسة الرعايه")).toBe("[ORG_1]");
  });

  it("finds a name after ل written «لل», and writes it back so (phase 3 probe)", () => {
    const m = createMasker([{ kind: "ORG", term: "النخبة", entity: "org:1" }, { kind: "ORG", term: "شركة النخبة القابضة", entity: "org:1" }]);
    const masked = m.mask("درجة نضج الحوكمة للنخبة 2.1، وللنخبة رأي، ولشركة النخبة القابضة، وبالنخبة");
    expect(masked).toBe("درجة نضج الحوكمة ل[ORG_1] 2.1، ول[ORG_1] رأي، ول[ORG_1]، وب[ORG_1]");
    expect(m.unmask("ل[ORG_1] و[ORG_1]")).toBe("للنخبة والنخبة");
    expect(m.unmask(m.mask("مراجعة لِلنُّخبة"))).toBe("مراجعة للنخبة");
    // Only after ل: «النخبة» inside another word, or «لنخبة» alone, is not the name.
    expect(m.mask("النخبةوي ونخبة لنخبة")).toBe("النخبةوي ونخبة لنخبة");
  });

  // Review of #209: B1, S1 to S4 and the notes.
  it("writes «ل» + a name back as it was, whatever the name starts with (B1)", () => {
    const round = (term: string, text: string, kind = "ORG") => {
      const m = createMasker([{ kind, term, entity: "e" }], { places: false });
      const masked = m.mask(text);
      expect(masked).toMatch(/\[(ORG|PERSON)_1\]/);
      return m.unmask(masked);
    };
    expect(round("آل سعود", "رسالة لآل سعود")).toBe("رسالة لآل سعود");
    expect(round("إلهام الحربي", "أرسلت لإلهام التقرير", "PERSON")).toBe("أرسلت لإلهام التقرير");
    expect(round("ألفا", "قدم لألفا")).toBe("قدم لألفا");
    // A name kept without its hamza («الهام» for «إلهام») is still found after ل as written.
    expect(round("الهام الحربي", "أرسلت لإلهام التقرير", "PERSON")).toBe("أرسلت لإلهام التقرير");
    // A name with the article as written, and one whose article meets a ل of its own.
    expect(round("الإنماء", "للإنماء وللإنماء")).toBe("للإنماء وللإنماء");
    expect(round("اللجنة", "رفع للجنة ثم اللجنة")).toBe("رفع للجنة ثم اللجنة");
    // The model writes «ل[ORG_1]» of a name it was given alone.
    const m = createMasker([{ kind: "ORG", term: "آل سعود", entity: "a" }, { kind: "ORG", term: "النخبة", entity: "o" }], { places: false });
    m.mask("آل سعود والنخبة");
    expect(m.unmask("ل[ORG_1] ول[ORG_2]")).toBe("لآل سعود وللنخبة");
  });

  it("finds «لل» + a name with tatweel anywhere (S1)", () => {
    for (const text of ["للـنخبة", "لـلنخبة", "ولـلنخبة", "للنخبـة"]) {
      const m = createMasker([{ kind: "ORG", term: "النخبة", entity: "o" }], { places: false });
      const masked = m.mask(text);
      expect(masked).toMatch(/^و?لـ*\[ORG_1\]$/);
      expect(m.unmask(masked)).toBe(text);
    }
  });

  it("gives each occurrence back in its own spelling (S2)", () => {
    const round = (terms: { kind: string; term: string; entity: string }[], text: string) => {
      const m = createMasker(terms, { places: false });
      return m.unmask(m.mask(text));
    };
    const ahmed = [{ kind: "PERSON", term: "أحمد العتيبي", entity: "p" }];
    expect(round(ahmed, "قال احمد ثم أحمد ثم أحـــمد")).toBe("قال احمد ثم أحمد ثم أحـــمد");
    expect(round([{ kind: "ORG", term: "النخبة", entity: "o" }], "النخبه ثم النخبة ثم للنخبة")).toBe("النخبه ثم النخبة ثم للنخبة");
    expect(round([{ kind: "ORG", term: "Vision 2030", entity: "v" }], "Vision ٢٠٣٠ and Vision 2030")).toBe("Vision ٢٠٣٠ and Vision 2030");
    expect(round([{ kind: "ORG", term: "رؤية 2030", entity: "v" }], "رؤية ٢٠٣٠ ورؤية 2030 ورؤيه ۲۰۳۰")).toBe("رؤية ٢٠٣٠ ورؤية 2030 ورؤيه ۲۰۳۰");
    // Still one placeholder for one record.
    const m = createMasker(ahmed, { places: false });
    expect(m.mask("احمد ثم أحمد")).toBe("[PERSON_1] ثم [PERSON_1]");
  });

  it("never writes «لAl-Nukhba»: after ل the name comes back in Arabic (S3)", () => {
    const terms = [
      { kind: "ORG", term: "Al-Nukhba", entity: "o" },
      { kind: "ORG", term: "النخبة", entity: "o" },
    ];
    const m = createMasker(terms, { places: false });
    expect(m.mask("Al-Nukhba asked")).toBe("[ORG_1] asked");
    expect(m.unmask("قدمنا ل[ORG_1] تقريراً")).toBe("قدمنا للنخبة تقريراً");
    // Between Arabic words, the Arabic spelling once the text had one.
    m.mask("وللنخبة رأي");
    expect(m.unmask("تقدمت [ORG_1] بطلب")).toBe("تقدمت النخبة بطلب");
    // A record with no Arabic name: kept apart from the ل.
    const latin = createMasker([{ kind: "ORG", term: "Rawdah Group", entity: "r" }], { places: false });
    latin.mask("Rawdah Group");
    expect(latin.unmask("ل[ORG_1]")).toBe("لـ Rawdah Group");
  });

  it("never masks a name inside another word (S4)", () => {
    const masks = (term: string, text: string, kind = "PERSON") => createMasker([{ kind, term, entity: "e" }], { places: false }).mask(text) !== text;
    // Must not mask.
    expect(masks("بشرى الحربي", "رأس المال البشري والتعايش")).toBe(false);
    expect(masks("سلمى القحطاني", "الانتقال السلمي للسلطة")).toBe(false);
    expect(masks("أمل", "التطبيق الكامل وشامل للعامل")).toBe(false);
    expect(masks("أمل", "كامل")).toBe(false);
    expect(masks("حكمة", "وفي حكمه أن القرار نهائي", "ORG")).toBe(false);
    // Must mask.
    expect(masks("أمل", "وأمل وبأمل لأمل")).toBe(true);
    expect(masks("بشرى الحربي", "قالت بشرى")).toBe(true);
    expect(masks("سلمى القحطاني", "وسلمى")).toBe(true);
    expect(masks("حكمة", "شركة حكمة وبحكمة", "ORG")).toBe(true);
    expect(masks("نخبة", "والنخبة وللنخبة", "ORG")).toBe(true);
    expect(masks("رؤية 2030", "رؤيه 2030", "ORG")).toBe(true);
    expect(masks("النخبة", "النخبه", "ORG")).toBe(true);
  });

  it("reads Arabic-Indic digits in a Latin name, and folds case as the database does", () => {
    const m = createMasker([{ kind: "ORG", term: "Vision 2030", entity: "v" }, { kind: "PERSON", term: "İnan Kaya", entity: "p" }], { places: false });
    expect(m.mask("VISION ۲۰۳۰ and inan kaya")).toBe("[ORG_1] and [PERSON_1]");
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

describe("indicator intent", () => {
  it("spots questions about the client's business indicators in both languages", () => {
    expect(indicatorIntent("How are our KPIs doing against target?")).toBe(true);
    expect(indicatorIntent("What is the latest value of the complaints indicator?")).toBe(true);
    expect(indicatorIntent("ما آخر قيمة لمؤشر الشكاوى؟")).toBe(true);
    expect(indicatorIntent("كم المستهدف لهذا العام؟")).toBe(true);
    expect(indicatorIntent("What does the charter say about the board?")).toBe(false);
    expect(indicatorIntent("ما الإجراءات المتأخرة؟")).toBe(false);
  });
});
