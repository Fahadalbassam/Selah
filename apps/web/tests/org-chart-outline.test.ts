// The outline editor's arithmetic (org chart, part 3): the draft as an
// indented list, and what each row's moves ask the server for. The server
// checks every move again (tests/db/org-chart-editor.test.ts).
import { describe, expect, it } from "vitest";
import { ORG_CHART_ERROR_KEYS, orgChartError, structureHint } from "@/lib/org-chart";
import { arrowMove, outlineTree, parseSpecialties, positionMove, reportsToChoices, unitAndBelow, unitMove } from "@/lib/org-chart-outline";
import ar from "../messages/ar.json";
import en from "../messages/en.json";

const u = (id: string, parentId: string | null, sortOrder = 0, code = id) => ({ id, parentId, sortOrder, code });
const p = (id: string, unitId: string, sortOrder = 0, reportsToId: string | null = null) => ({ id, unitId, sortOrder, code: id, reportsToId });

// Board > CEO > (Legal, Finance > Payables); positions in Finance.
const UNITS = [u("board", null), u("ceo", "board"), u("finance", "ceo", 1), u("legal", "ceo", 0), u("payables", "finance")];
const POSITIONS = [p("cfo", "finance", 0), p("analyst", "finance", 2, "cfo"), p("clerk", "finance", 1, "analyst"), p("chair", "board")];

describe("the draft as a list", () => {
  it("nests units in the firm's order, with each unit's positions in their own order", () => {
    const [board] = outlineTree(UNITS, POSITIONS);
    expect(board!.unit.id).toBe("board");
    const ceo = board!.children[0]!;
    expect(ceo.children.map((c) => c.unit.id)).toEqual(["legal", "finance"]);
    const finance = ceo.children[1]!;
    expect(finance.positions.map((x) => x.id)).toEqual(["cfo", "clerk", "analyst"]);
    expect([finance.depth, finance.index, finance.siblings, finance.previousId, finance.parentId, finance.parentIndex, finance.grandparentId]).toEqual([
      2,
      1,
      2,
      "legal",
      "ceo",
      0,
      "board",
    ]);
  });

  it("moves a unit up, down, under the unit above it, or out to just after its parent; nothing past the ends", () => {
    const ceo = outlineTree(UNITS, POSITIONS)[0]!.children[0]!;
    const [legal, finance] = ceo.children;
    expect(unitMove(finance!, "up")).toEqual({ parentId: "ceo", index: 0 });
    expect(unitMove(finance!, "down")).toBeNull();
    expect(unitMove(legal!, "up")).toBeNull();
    expect(unitMove(legal!, "down")).toEqual({ parentId: "ceo", index: 1 });
    expect(unitMove(finance!, "indent")).toEqual({ parentId: "legal" });
    expect(unitMove(legal!, "indent")).toBeNull();
    expect(unitMove(finance!, "outdent")).toEqual({ parentId: "board", index: 1 });
    const board = outlineTree(UNITS, POSITIONS)[0]!;
    expect(unitMove(board, "outdent")).toBeNull();
  });

  it("moves a position up and down inside its unit", () => {
    const finance = outlineTree(UNITS, POSITIONS)[0]!.children[0]!.children[1]!;
    expect(positionMove(finance.positions, "clerk", "up")).toEqual({ unitId: "finance", index: 0 });
    expect(positionMove(finance.positions, "cfo", "up")).toBeNull();
    expect(positionMove(finance.positions, "analyst", "down")).toBeNull();
  });

  it("never offers a unit under itself or its own units, nor a reporting line that loops", () => {
    expect([...unitAndBelow(UNITS, "ceo")].sort()).toEqual(["ceo", "finance", "legal", "payables"]);
    // The clerk reports to the analyst, who reports to the CFO: the CFO may not report to either.
    expect(reportsToChoices(POSITIONS, "cfo").map((x) => x.id)).toEqual(["chair"]);
    expect(reportsToChoices(POSITIONS, "clerk").map((x) => x.id).sort()).toEqual(["analyst", "cfo", "chair"]);
    expect(reportsToChoices(POSITIONS, null)).toHaveLength(4);
  });

  it("reads specialties one per line, or split by the usual separators, once each", () => {
    expect(parseSpecialties(" budgets \nreporting؛ budgets, tax ،audit;")).toEqual(["budgets", "reporting", "tax", "audit"]);
  });

  it("Alt with an arrow: up and down move; the side arrows indent towards the reading direction's end", () => {
    expect(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "a"].map((k) => arrowMove(k, true))).toEqual(["up", "down", "indent", "outdent", null]);
    expect(["ArrowLeft", "ArrowRight"].map((k) => arrowMove(k, false))).toEqual(["outdent", "indent"]);
  });
});

describe("the Structure page's header says only what is true now (S4)", () => {
  it("with nothing drawn yet: how to start, never levels or a PDF", () => {
    expect(structureHint({ hasUnits: false })).toBe("hintEmpty");
    expect(structureHint({ hasUnits: true })).toBe("hint");
    const chart = (m: unknown) => (m as { orgChart: Record<string, unknown> }).orgChart;
    expect(chart(en).hintEmpty).toMatch(/top unit/);
    expect(chart(en).hintEmpty).not.toMatch(/level|PDF/i);
    expect(chart(ar).hintEmpty).not.toMatch(/المستويات|PDF/);
    // The structure exists for the reader once drawn: the usual line, which mentions both.
    expect(chart(en).hint).toMatch(/PDF/);
  });
});

describe("the editor's refusals, in the reader's language", () => {
  const errors = (m: unknown) => (m as { orgChart: { errors: Record<string, string> } }).orgChart.errors;
  it("every refusal the services and the database word has a sentence in both languages", () => {
    for (const key of ORG_CHART_ERROR_KEYS) {
      expect(orgChartError(key)).toBe(key);
      expect(errors(ar)[key], key).toBeTruthy();
      expect(errors(en)[key], key).toBeTruthy();
    }
    for (const [db, key] of [
      ["this person already holds the position on some of those days", "alreadyHolds"],
      ["a holder is one of the client's own active people, or a typed name", "ownPeople"],
      ["a holding ends on or after the day it started", "endBefore"],
      ["this holding has already ended", "alreadyEnded"],
      ["nothing is published yet to start again from", "nothingPublished"],
      ["a unit cannot sit under itself or under one of its own units", "cycle"],
    ] as const) {
      expect(orgChartError(db)).toBe(key);
      expect(errors(ar)[key]).toBeTruthy();
      expect(errors(en)[key]).toBeTruthy();
    }
  });

  it("starting again and removing a position say plainly what is lost, and that nobody's holding changes (S2)", () => {
    const editor = (m: unknown) => (m as { orgChart: { editor: Record<string, string> } }).orgChart.editor;
    expect(editor(ar).restartConfirm).toMatch(/الوحدات والمناصب/);
    expect(editor(ar).restartConfirm).toMatch(/شاغلي المناصب/);
    expect(editor(en).restartConfirm).toMatch(/units and positions/);
    expect(editor(en).restartConfirm).toMatch(/nobody's holding/i);
    expect(editor(en).removePositionConfirm).toMatch(/published structure/);
    expect(editor(ar).removePositionConfirm).toMatch(/الهيكل المنشور/);
  });

  it("the removal asks first, in plain words, that it cannot be undone", () => {
    const holders = (m: unknown) => (m as { orgChart: { holders: Record<string, string> } }).orgChart.holders;
    expect(holders(ar).removeConfirm).toContain("لا يمكن التراجع");
    expect(holders(en).removeConfirm).toContain("cannot be undone");
    // The card says it shows only what the reader can open, and never judges the person.
    const card = (m: unknown) => JSON.stringify((m as { orgChart: { card: unknown } }).orgChart.card);
    expect(card(en)).not.toMatch(/score|rank|rating|performance/i);
  });
});
