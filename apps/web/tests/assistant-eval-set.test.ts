// The labelled test set for the assistant (section 7 item 7,
// scripts/assistant-eval/testset/) holds what the plan asked for, and its
// scoring rests on a true assumption: the indexer never cuts a marked passage,
// so "a search result covers a passage" is plain text containment.
import { describe, expect, it } from "vitest";
import { pagesFromText, passages } from "@/jobs/index-documents";
import { CORPUS, fileText, PASSAGE_MAX, passageById } from "../scripts/assistant-eval/testset/corpus";
import { FULL_SAMPLE, QUESTIONS } from "../scripts/assistant-eval/testset/questions";

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

describe("the labelled test set's files", () => {
  it("has 50 or more files in each of the three projects, in Arabic, English and both", () => {
    for (const project of ["board", "waha", "rawdah"] as const) {
      const files = CORPUS.filter((f) => f.project === project);
      expect(files.length, project).toBeGreaterThanOrEqual(50);
      expect(new Set(files.map((f) => f.lang)), project).toEqual(new Set(["ar", "en", "mixed"]));
    }
  });

  it("has a scanned page, two versions of one policy, and long files", () => {
    expect(CORPUS.some((f) => f.kind === "scanned-pdf" && f.imageOnly)).toBe(true);
    expect(CORPUS.filter((f) => f.title.startsWith("سياسة مكافآت أعضاء المجلس")).map((f) => f.key)).toEqual(["N.rem.v1", "N.rem.v2"]);
    // About 4,000 tokens or more: long enough that a 4,096-token context would cut its passages.
    expect(CORPUS.filter((f) => fileText(f).length >= 9000).length).toBeGreaterThanOrEqual(4);
  });

  it("keeps every passage whole when the indexer splits the file", () => {
    const ids = CORPUS.flatMap((f) => f.pages.flat().map((x) => x.id));
    expect(new Set(ids).size).toBe(ids.length);
    for (const f of CORPUS) {
      if (f.kind !== "text") continue;
      const chunks = passages(pagesFromText(fileText(f))).map((c) => norm(c.text));
      for (const x of f.pages.flat()) {
        expect(x.text.length, x.id).toBeLessThanOrEqual(PASSAGE_MAX);
        expect(x.text, x.id).not.toMatch(/\n/);
        expect(chunks.some((c) => c.includes(norm(x.text))), x.id).toBe(true);
      }
    }
  });
});

describe("the labelled test set's questions", () => {
  const corpusQs = QUESTIONS.filter((q) => q.group !== "reference");

  it("has about 100 questions with their right passages marked, in both languages", () => {
    expect(corpusQs.length).toBeGreaterThanOrEqual(100);
    expect(new Set(QUESTIONS.map((q) => q.id)).size).toBe(QUESTIONS.length);
    for (const lang of ["ar", "en"]) expect(corpusQs.filter((q) => q.lang === lang).length).toBeGreaterThanOrEqual(35);
    for (const q of corpusQs) {
      if (q.expect === "answer" && !q.group.startsWith("follow-up-across")) expect(q.gold.length, q.id).toBeGreaterThan(0);
      for (const g of q.gold) expect(g.startsWith("act:") || passageById.has(g), `${q.id} ${g}`).toBe(true);
    }
  });

  it("covers the cases the 19 Nov run found weak", () => {
    expect(corpusQs.filter((q) => q.group === "versions-ar").length).toBeGreaterThanOrEqual(5);
    expect(corpusQs.filter((q) => q.group === "follow-up-across").length).toBeGreaterThanOrEqual(2);
    expect(corpusQs.filter((q) => q.group === "due-this-week").length).toBeGreaterThanOrEqual(3);
  });

  it("asks about every reference work in both languages, answerable only from a reference source", () => {
    const ref = QUESTIONS.filter((q) => q.group === "reference");
    const sources = new Set(ref.map((q) => q.ref?.source));
    expect(sources.size).toBe(6);
    for (const s of sources) expect(new Set(ref.filter((q) => q.ref?.source === s).map((q) => q.lang)), s).toEqual(new Set(["ar", "en"]));
    // No client file holds the answer: today the right result is "can't confirm".
    for (const q of ref) expect([q.gold.length, q.expect], q.id).toEqual([0, "cannot"]);
  });

  it("answers 20 in full, each follow-up with the question it follows", () => {
    expect(FULL_SAMPLE).toHaveLength(20);
    for (const id of FULL_SAMPLE) {
      const q = QUESTIONS.find((x) => x.id === id);
      expect(q, id).toBeDefined();
      if (q?.follow) expect(FULL_SAMPLE.indexOf(q.follow), id).toBeGreaterThanOrEqual(0);
      if (q?.follow) expect(FULL_SAMPLE.indexOf(q.follow), id).toBeLessThan(FULL_SAMPLE.indexOf(id));
    }
  });
});
